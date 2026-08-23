import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseSignedRequest } from "@/lib/meta/signed-request";

export const runtime = "nodejs";

/**
 * Meta calls this when a user removes OpenReply from their Instagram account.
 * The connection is already dead at Meta's end by the time this arrives, so
 * the stored account and its encrypted token are removed rather than flagged.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get("signed_request");

  const payload = parseSignedRequest(
    typeof signedRequest === "string" ? signedRequest : null
  );

  if (!payload?.user_id) {
    return NextResponse.json(
      { success: false, error: "Invalid signed request" },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { instagramId: payload.user_id },
  });

  // Meta retries deauthorize callbacks, so an account that is already gone is
  // a success, not an error.
  if (!account) {
    return NextResponse.json({ success: true });
  }

  await prisma.instagramAccount.delete({ where: { id: account.id } });

  await prisma.operationalEvent
    .create({
      data: {
        source: "SYSTEM",
        level: "WARNING",
        workspaceId: account.workspaceId,
        message: "Instagram account deauthorized by the user",
        payload: { username: account.username },
      },
    })
    .catch(() => {});

  return NextResponse.json({ success: true });
}
