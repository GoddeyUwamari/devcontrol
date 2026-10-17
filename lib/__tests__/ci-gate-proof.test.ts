import { describe, expect, it } from "vitest";
describe("TEMPORARY ci gate proof (frontend) -- revert before merge", () => {
  it("fails on purpose", () => { expect(1).toBe(2); });
});
