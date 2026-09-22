import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchTrigger, type TriggerCampaign } from "../lib/utils/trigger-matcher";

const campaign: TriggerCampaign = {
  name: "Linen drop",
  keywords: ["LINK", "SHOP"],
  matchAnyWord: false,
  wholeWordMatch: true,
  intentMatching: false,
  spamFilterEnabled: false,
  offerDescription: "The link to shop the linen collection",
  goal: null,
  dmMessage: "Hey {username}! Here's the link",
};

const fetchMock = vi.fn();

function answers(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ answers: body }), text: async () => "" };
}

function intent(choice: string, confidence: number) {
  return { type: "choice", choice, confidence, probabilities: { [choice]: confidence } };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TYPESAFE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("matchTrigger — keyword-only campaigns", () => {
  it("uses keywords and never calls TypeSafe when both options are off", async () => {
    expect((await matchTrigger(campaign, "send me the link")).matched).toBe(true);
    expect((await matchTrigger(campaign, "send it pls")).matched).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to keywords when TYPESAFE_API_KEY is unset", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const result = await matchTrigger({ ...campaign, intentMatching: true }, "send it pls");
    expect(result.matched).toBe(false);
    expect(result.skipReason).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("matchTrigger — intent matching", () => {
  const intentCampaign = { ...campaign, intentMatching: true };

  it("fires on a confident request with no keyword", async () => {
    fetchMock.mockResolvedValueOnce(answers({ intent: intent("requests_offer", 0.95) }));
    const result = await matchTrigger(intentCampaign, "send it to me pls");
    expect(result).toEqual({ matched: true, matchedKeyword: null });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.state).toEqual({
      campaign: { offer: "The link to shop the linen collection", trigger_words: ["LINK", "SHOP"] },
      message: "send it to me pls",
    });
    expect(body.questions.intent.type).toBe("choice");
  });

  it("keeps the matched keyword for stats when intent agrees", async () => {
    fetchMock.mockResolvedValueOnce(answers({ intent: intent("requests_offer", 0.9) }));
    const result = await matchTrigger(intentCampaign, "can I get the link please");
    expect(result).toEqual({ matched: true, matchedKeyword: "LINK" });
  });

  it("rejects a keyword hit that is not a request, with a reason", async () => {
    fetchMock.mockResolvedValueOnce(answers({ intent: intent("problem_report", 0.99) }));
    const result = await matchTrigger(intentCampaign, "the link in your bio is broken");
    expect(result.matched).toBe(false);
    expect(result.skipReason).toBe("Intent: problem_report (confidence 0.99)");
  });

  it("does not act on a low-confidence request", async () => {
    fetchMock.mockResolvedValueOnce(answers({ intent: intent("requests_offer", 0.55) }));
    const result = await matchTrigger(intentCampaign, "first!");
    expect(result.matched).toBe(false);
    expect(result.skipReason).toMatch(/^Intent: requests_offer/);
  });

  it("fires on a bare trigger word without calling TypeSafe", async () => {
    expect((await matchTrigger(intentCampaign, "Link!! 🙏")).matched).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to keywords when TypeSafe errors", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" });
    expect((await matchTrigger(intentCampaign, "the link is broken")).matched).toBe(true);
    expect((await matchTrigger(intentCampaign, "send it pls")).matched).toBe(false);
  });

  it("falls back to the DM text when no offer description is set", async () => {
    fetchMock.mockResolvedValueOnce(answers({ intent: intent("requests_offer", 0.9) }));
    await matchTrigger({ ...intentCampaign, offerDescription: null }, "me please");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.state.campaign.offer).toBe("Linen drop — Hey ! Here's the link");
  });
});

describe("matchTrigger — spam filter", () => {
  it("skips spam on an any-word campaign", async () => {
    fetchMock.mockResolvedValueOnce(answers({ spam: { type: "noul", noul: 0.97 } }));
    const result = await matchTrigger(
      { ...campaign, matchAnyWord: true, spamFilterEnabled: true },
      "Buy followers cheap at growfast"
    );
    expect(result.matched).toBe(false);
    expect(result.skipReason).toBe("Spam filter (0.97)");
  });

  it("lets a normal comment through", async () => {
    fetchMock.mockResolvedValueOnce(answers({ spam: { type: "noul", noul: 0.05 } }));
    const result = await matchTrigger(
      { ...campaign, matchAnyWord: true, spamFilterEnabled: true },
      "love this!"
    );
    expect(result.matched).toBe(true);
  });

  it("does not spend a call on comments that missed the keywords", async () => {
    const result = await matchTrigger({ ...campaign, spamFilterEnabled: true }, "gorgeous");
    expect(result.matched).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks intent and spam in one request", async () => {
    fetchMock.mockResolvedValueOnce(
      answers({ intent: intent("requests_offer", 0.9), spam: { type: "noul", noul: 0.9 } })
    );
    const result = await matchTrigger(
      { ...campaign, intentMatching: true, spamFilterEnabled: true },
      "get the link at growfast dot io"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.skipReason).toBe("Spam filter (0.90)");
  });
});
