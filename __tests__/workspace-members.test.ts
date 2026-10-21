import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    workspaceMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    workspaceInvitation: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
  mockContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  getCurrentWorkspaceContext: mockContext,
}));

import { POST } from "../app/api/workspace/members/route";

function inviteRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspace/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.mockResolvedValue({
    workspaceId: "workspace_123",
    userId: "user_admin",
    role: "ADMIN",
  });
  mockPrisma.workspaceMember.findMany.mockResolvedValue([]);
  mockPrisma.workspaceInvitation.findMany.mockResolvedValue([]);
});

describe("POST /api/workspace/members", () => {
  it("refuses to change an existing owner's role through an invite", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_owner" });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({ id: "member_owner" });

    const res = await POST(inviteRequest({ email: "owner@example.com", role: "MEMBER" }));

    expect(res.status).toBe(400);
    expect(mockPrisma.workspaceMember.upsert).not.toHaveBeenCalled();
  });

  it("leaves an existing member's role alone", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_member" });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({ id: "member_1" });

    const res = await POST(inviteRequest({ email: "member@example.com", role: "ADMIN" }));

    expect(res.status).toBe(400);
    expect(mockPrisma.workspaceMember.upsert).not.toHaveBeenCalled();
  });

  it("adds an existing user who is not yet a member, without an update branch", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_new" });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    const res = await POST(inviteRequest({ email: "new@example.com", role: "MEMBER" }));

    expect(res.status).toBe(200);
    expect(mockPrisma.workspaceMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: "user_new", role: "MEMBER" }),
        update: {},
      })
    );
  });
});
