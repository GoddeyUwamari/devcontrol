/**
 * authService.resetPassword sends the body POST /api/auth/reset-password
 * expects (backend/src/controllers/auth.controller.ts: { token, newPassword }).
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

describe("authService.resetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPost.mockResolvedValue({ data: { success: true } } as unknown as Awaited<ReturnType<typeof api.post>>);
  });

  it("posts { token, newPassword } to /api/auth/reset-password", async () => {
    await authService.resetPassword({ token: "reset-token-abc", password: "Str0ng!Passw0rd" });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith("/api/auth/reset-password", {
      token: "reset-token-abc",
      newPassword: "Str0ng!Passw0rd",
    });
  });

  it("does not send a `password` field", async () => {
    await authService.resetPassword({ token: "reset-token-abc", password: "Str0ng!Passw0rd" });

    const body = mockedPost.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["newPassword", "token"]);
    expect(body).not.toHaveProperty("password");
  });

  it("propagates an API rejection to the caller", async () => {
    const rejection = Object.assign(new Error("Request failed with status code 400"), {
      response: { status: 400, data: { success: false, error: "Invalid or expired reset token" } },
    });
    mockedPost.mockRejectedValue(rejection);

    await expect(
      authService.resetPassword({ token: "expired", password: "Str0ng!Passw0rd" })
    ).rejects.toBe(rejection);
  });
});
