/**
 * servicesService.create sends the body POST /api/services validates
 * (backend/src/validators/schemas.ts createServiceSchema: team_id, github_url).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { servicesService } from "../services.service";
import api from "@/lib/api";
import { createServiceSchema } from "../../../backend/src/validators/schemas";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { post: vi.fn() } };
});

const mockedPost = vi.mocked(api.post);

const TEAM_ID = "00000000-0000-4000-8000-000000000001";

// What app/(app)/services/new/page.tsx passes for a valid form.
const formPayload = {
  name: "payments-api",
  template: "api" as const,
  owner: "owner@example.com",
  teamId: TEAM_ID,
  description: "Handles payments",
  githubUrl: "https://github.com/example/payments-api",
};

describe("servicesService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPost.mockResolvedValue({
      data: { success: true, data: { id: "svc-1", team_id: TEAM_ID } },
    } as unknown as Awaited<ReturnType<typeof api.post>>);
  });

  it("posts a body that passes the backend's createServiceSchema, keeping team_id and github_url", async () => {
    await servicesService.create(formPayload);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockedPost.mock.calls[0];
    expect(url).toBe("/api/services");

    const parsed = createServiceSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      name: "payments-api",
      template: "api",
      owner: "owner@example.com",
      team_id: TEAM_ID,
      github_url: "https://github.com/example/payments-api",
      description: "Handles payments",
    });
  });

  it("passes validation when the optional GitHub URL and description are left empty", async () => {
    await servicesService.create({ ...formPayload, githubUrl: undefined, description: undefined });

    const parsed = createServiceSchema.safeParse(mockedPost.mock.calls[0][1]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.team_id).toBe(TEAM_ID);
  });

  it("the old camelCase body is rejected by the backend schema", () => {
    expect(createServiceSchema.safeParse(formPayload).success).toBe(false);
  });
});
