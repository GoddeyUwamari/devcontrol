/**
 * authService.verifyEmail sends the body POST /api/auth/verify-email expects
 * (backend/src/controllers/auth.controller.ts: { token }).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../auth.service";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
  },
}));

const mockedPost = vi.mocked(api.post);

describe("authService.verifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPost.mockResolvedValue({ data: { success: true } } as unknown as Awaited<ReturnType<typeof api.post>>);
  });

  it("posts { token } to /api/auth/verify-email", async () => {
    await authService.verifyEmail("verification-token-abc");

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith("/api/auth/verify-email", { token: "verification-token-abc" });
  });

  it("propagates an API rejection to the caller", async () => {
    const rejection = Object.assign(new Error("Request failed with status code 400"), {
      response: { status: 400, data: { success: false, error: "Invalid or expired verification token" } },
    });
    mockedPost.mockRejectedValue(rejection);

    await expect(authService.verifyEmail("expired")).rejects.toBe(rejection);
  });
});
