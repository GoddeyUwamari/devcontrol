/**
 * servicesService.getRegistered reads GET /api/services/registered as the
 * backend answers it (backend/src/routes/services.routes.ts):
 * { success, services: [{ id, name, owner, team_id, team_name, github_url,
 * created_at }], total }. A response without that key is an error, never an
 * empty list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { servicesService } from "../services.service";
import api from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get: vi.fn() } };
});

const mockedGet = vi.mocked(api.get);
type GetResult = Awaited<ReturnType<typeof api.get>>;

// Exactly the route's JSON for two rows (see services.routes.registered.test.ts).
const ROUTE_RESPONSE = {
  success: true,
  services: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "payments-api",
      owner: "owner@example.com",
      team_id: "00000000-0000-4000-8000-0000000000aa",
      team_name: "Payments",
      github_url: "https://github.com/example/payments-api",
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "worker",
      owner: "owner@example.com",
      team_id: null,
      team_name: null,
      github_url: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 2,
};

describe("servicesService.getRegistered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls /api/services/registered and maps the services key", async () => {
    mockedGet.mockResolvedValue({ data: ROUTE_RESPONSE } as unknown as GetResult);

    const services = await servicesService.getRegistered();

    expect(mockedGet).toHaveBeenCalledWith("/api/services/registered");
    expect(services).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "payments-api",
        owner: "owner@example.com",
        teamId: "00000000-0000-4000-8000-0000000000aa",
        teamName: "Payments",
        githubUrl: "https://github.com/example/payments-api",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "worker",
        owner: "owner@example.com",
        teamId: null,
        teamName: null,
        githubUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("an empty organization is an empty list", async () => {
    mockedGet.mockResolvedValue({ data: { success: true, services: [], total: 0 } } as unknown as GetResult);
    await expect(servicesService.getRegistered()).resolves.toEqual([]);
  });

  it("a response shaped like { data: [...] } is an error, not an empty list", async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: ROUTE_RESPONSE.services } } as unknown as GetResult);
    await expect(servicesService.getRegistered()).rejects.toThrow("Failed to load registered services");
  });

  it("success: false carries the route's error", async () => {
    mockedGet.mockResolvedValue({ data: { success: false, error: "Unauthorized" } } as unknown as GetResult);
    await expect(servicesService.getRegistered()).rejects.toThrow("Unauthorized");
  });
});
