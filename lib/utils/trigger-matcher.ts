/**
 * Trigger matcher
 *
 * Decides whether a comment (or inbound DM) should fire a campaign. Wraps the
 * deterministic keyword matcher with two optional, per-campaign TypeSafe checks:
 *
 * - Intent matching: instead of requiring a literal keyword, ask whether the
 *   person is actually asking for what the campaign sends. Catches typos, emoji
 *   and phrasing like "send it to me pls", and rejects keyword hits that are not
 *   requests ("the link in your bio is broken", "already bought it").
 * - Spam filter: skip comments that are spam or promotion by another account.
 *   Most useful on "any word" campaigns, which otherwise DM every commenter.
 *
 * Both fail open to the keyword path: if TypeSafe is unconfigured, slow or
 * erroring, the campaign behaves exactly as it would without them.
 */

import { askTypeSafe, isTypeSafeConfigured, type TypeSafeQuestion } from "@/lib/typesafe/client";
import { matchKeywords, stripSpecialCharacters } from "@/lib/utils/keyword-matcher";

// Act on a "requests_offer" intent only when the distribution is concentrated.
// On test data this removed borderline false DMs ("first!", "I don't have a
// plan lol") while keeping clear requests.
export const INTENT_CONFIDENCE_THRESHOLD = 0.7;
export const SPAM_THRESHOLD = 0.8;

export interface TriggerCampaign {
  name: string;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  intentMatching?: boolean;
  spamFilterEnabled?: boolean;
  offerDescription?: string | null;
  goal?: string | null;
  dmMessage: string;
}

export interface TriggerMatchResult {
  matched: boolean;
  matchedKeyword: string | null;
  /** Set when TypeSafe rejected the message; logged so decisions can be audited. */
  skipReason?: string;
}

const INTENT_OPTIONS: Record<string, string> = {
  requests_offer:
    "Wants what `campaign.offer` provides sent to them: replies with a trigger word (including typos, repeated letters or a matching emoji), or asks for the link, info, details, price, how to get or buy it, or says something like 'me please' or 'send it'",
  product_question:
    "Asks a specific question about the product or content itself (size, material, results, availability) without asking for it to be sent",
  praise_or_reaction: "Compliment, emoji reaction, or general enthusiasm without a request",
  negative_or_declining: "Complains, criticises, declines, or says they do not want it",
  already_has_it: "Says they already bought it, already have it, or already received the link",
  problem_report: "Reports that a link, the offer, or a previous DM is broken or did not arrive",
  spam_or_promo: "Promotes another account, service, or scam",
  other: "Tags a friend, or anything else",
};

function intentQuestion(): TypeSafeQuestion {
  return {
    type: "choice",
    instructions:
      "An Instagram account automatically sends `campaign.offer` to people who ask for it, usually by commenting or messaging one of `campaign.trigger_words`. What is `message` doing?",
    criteria: INTENT_OPTIONS,
  };
}

const SPAM_QUESTION: TypeSafeQuestion = {
  type: "noul",
  instructions: "Is `message` spam, a scam, or promotion of another account or service?",
};

/** True when the whole message is just one of the trigger words ("LINK!!", "link 🙏"). */
function isBareKeyword(text: string, keywords: string[]): boolean {
  const cleaned = stripSpecialCharacters(text).toLowerCase();
  return Boolean(cleaned) && keywords.some((k) => stripSpecialCharacters(k).toLowerCase() === cleaned);
}

function describeOffer(c: TriggerCampaign): string {
  if (c.offerDescription?.trim()) return c.offerDescription.trim();
  // Fall back to what the DM actually says, minus the personalisation token.
  const dm = c.dmMessage.replace(/\{username\}/g, "").trim();
  return [c.name, c.goal, dm].filter(Boolean).join(" — ");
}

export async function matchTrigger(
  campaign: TriggerCampaign,
  text: string
): Promise<TriggerMatchResult> {
  const keywordResult = campaign.matchAnyWord
    ? { matched: true, matchedKeyword: null }
    : matchKeywords(text, campaign.keywords, campaign.wholeWordMatch);

  // A reply that is only a trigger word is an unambiguous request; don't spend a
  // judgment (or risk a miss) on the most common comment of all.
  const useIntent =
    Boolean(campaign.intentMatching) &&
    !campaign.matchAnyWord &&
    !isBareKeyword(text, campaign.keywords);
  const useSpam = Boolean(campaign.spamFilterEnabled);

  // Nothing for TypeSafe to decide: plain keyword behaviour.
  if ((!useIntent && !useSpam) || !text.trim() || !isTypeSafeConfigured()) {
    return keywordResult;
  }
  // Spam-only campaigns never need a judgment on comments that did not match.
  if (!useIntent && !keywordResult.matched) return keywordResult;

  const questions: Record<string, TypeSafeQuestion> = {};
  if (useIntent) questions.intent = intentQuestion();
  if (useSpam) questions.spam = SPAM_QUESTION;

  let answers;
  try {
    answers = await askTypeSafe(
      {
        campaign: { offer: describeOffer(campaign), trigger_words: campaign.keywords },
        message: text,
      },
      questions
    );
  } catch (error) {
    console.log(
      "[Trigger] TypeSafe unavailable, falling back to keywords:",
      error instanceof Error ? error.message : error
    );
    return keywordResult;
  }

  const spam = answers.spam;
  if (spam?.type === "noul" && spam.noul > SPAM_THRESHOLD) {
    return { matched: false, matchedKeyword: null, skipReason: `Spam filter (${spam.noul.toFixed(2)})` };
  }

  if (!useIntent) return keywordResult;

  const intent = answers.intent;
  if (intent?.type !== "choice") return keywordResult;

  if (intent.choice === "requests_offer" && intent.confidence >= INTENT_CONFIDENCE_THRESHOLD) {
    return { matched: true, matchedKeyword: keywordResult.matchedKeyword };
  }
  return {
    matched: false,
    matchedKeyword: null,
    skipReason: `Intent: ${intent.choice} (confidence ${intent.confidence.toFixed(2)})`,
  };
}
