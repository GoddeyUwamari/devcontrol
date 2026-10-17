/**
 * takeUrlCredentials: credentials are read from the fragment only, and are
 * gone from the URL by the time it returns. Credentials in the query string
 * are never returned, but are removed from the URL and history all the same.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { takeUrlCredentials } from "../url-credentials";

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

function currentPath() {
  return window.location.pathname + window.location.search + window.location.hash;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  visit("/");
});

describe("takeUrlCredentials", () => {
  it("reads credentials from the fragment and removes the fragment before returning", () => {
    visit("/auth/sso/callback#token=AAA&refreshToken=RRR&orgId=OOO");

    const found = takeUrlCredentials(["token", "refreshToken", "orgId"] as const);

    expect(found).toEqual({ token: "AAA", refreshToken: "RRR", orgId: "OOO" });
    expect(currentPath()).toBe("/auth/sso/callback");
    expect(window.location.href).not.toContain("AAA");
    expect(window.location.href).not.toContain("RRR");
  });

  it("does not return query-string credentials, but removes them before returning", () => {
    visit("/reset-password?token=LEGACY&refreshToken=LEGACY_R");

    const found = takeUrlCredentials(["token", "refreshToken"] as const);

    expect(found).toEqual({});
    expect(currentPath()).toBe("/reset-password");
  });

  it("prefers the fragment and clears both forms when a link carries both", () => {
    visit("/reset-password?token=OLD#token=NEW");

    expect(takeUrlCredentials(["token"] as const)).toEqual({ token: "NEW" });
    expect(currentPath()).toBe("/reset-password");
  });

  it("removes only the named parameters and keeps the rest of the URL", () => {
    visit("/reset-password?utm_source=email&token=T#token=F&section=form");

    takeUrlCredentials(["token"] as const);

    expect(currentPath()).toBe("/reset-password?utm_source=email#section=form");
  });

  it("leaves a fragment without credentials untouched", () => {
    visit("/reset-password#form");

    expect(takeUrlCredentials(["token"] as const)).toEqual({});
    expect(currentPath()).toBe("/reset-password#form");
  });

  it("does not touch history when there is nothing to remove", () => {
    visit("/auth/sso/callback");
    const replaceState = vi.spyOn(window.history, "replaceState");

    expect(takeUrlCredentials(["token", "refreshToken"] as const)).toEqual({});
    vi.runAllTimers();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("cleans the URL synchronously, keeping the router's history state, then re-applies it so the router adopts it", () => {
    const routerState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["tree"] };
    window.history.replaceState(routerState, "", "/auth/sso/callback#token=AAA&refreshToken=RRR");
    const replaceState = vi.spyOn(window.history, "replaceState");

    takeUrlCredentials(["token", "refreshToken"] as const);

    // Immediate: same (credential-free) history state, clean URL.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][0]).toEqual(routerState);
    expect(replaceState.mock.calls[0][2]).toBe("/auth/sso/callback");

    // Next task: a plain call (no router marker), which Next.js's history
    // patch turns into a router URL update.
    vi.runAllTimers();
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(replaceState.mock.calls[1][0]).toBeNull();
    expect(replaceState.mock.calls[1][2]).toBe("/auth/sso/callback");
  });

  it.each([
    ["fragment", "/reset-password#token=SECRET123"],
    ["query string (not returned)", "/reset-password?token=SECRET123"],
  ])("%s: removes the load URL the router recorded in its route tree from history state", (_form, link) => {
    // Shape Next.js stores: the page segment keeps the URL it was loaded with.
    const tree = ["", { children: ["(auth)", { children: ["reset-password", { children: ["__PAGE__", {}, link, "refresh"] }] }] }, null, null, true];
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree }, "", link);

    takeUrlCredentials(["token"] as const);

    const state = window.history.state;
    expect(JSON.stringify(state)).not.toContain("SECRET123");
    expect(state.__NA).toBe(true);
    expect(state.__PRIVATE_NEXTJS_INTERNALS_TREE[1].children[1].children[1].children[2]).toBe("/reset-password");

    vi.runAllTimers();
    expect(JSON.stringify(window.history.state)).not.toContain("SECRET123");
  });

  it("blanks a credential value that appears in history state in some other form", () => {
    const secret = "SECRET0123456789abcdef";
    window.history.replaceState({ __NA: true, note: `full=http://x/reset-password?token=${secret}` }, "", `/reset-password#token=${secret}`);

    takeUrlCredentials(["token"] as const);

    expect(JSON.stringify(window.history.state)).not.toContain(secret);
    expect(window.history.state.__NA).toBe(true);
  });

  it("blanks a query-string credential that appears in history state in some other form, without returning it", () => {
    const secret = "SECRET0123456789abcdef";
    // Shape Next.js stores for a page loaded with search params: the page
    // segment key carries them as JSON, so the load URL is not there to match.
    const tree = ["", { children: [`__PAGE__?${JSON.stringify({ token: secret })}`, {}, null, null] }];
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree }, "", `/reset-password?token=${secret}`);

    expect(takeUrlCredentials(["token"] as const)).toEqual({});

    expect(currentPath()).toBe("/reset-password");
    expect(JSON.stringify(window.history.state)).not.toContain(secret);
    expect(window.history.state.__NA).toBe(true);
    vi.runAllTimers();
    expect(JSON.stringify(window.history.state)).not.toContain(secret);
  });

  it("does not blank a value shorter than 16 characters elsewhere in history state, but still cleans the URL and the recorded load URL", () => {
    const tree = ["", { children: ["__PAGE__", {}, "/reset-password#token=a", "refresh"] }];
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree }, "", "/reset-password#token=a");

    expect(takeUrlCredentials(["token"] as const)).toEqual({ token: "a" });

    expect(window.location.hash).toBe("");
    const state = window.history.state;
    // The router's own keys and tree survive intact (no single-letter strip).
    expect(state.__NA).toBe(true);
    expect(Object.keys(state)).toEqual(["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"]);
    expect(state.__PRIVATE_NEXTJS_INTERNALS_TREE[1].children).toEqual(["__PAGE__", {}, "/reset-password", "refresh"]);
  });

  it("does not re-apply the clean URL once the page has navigated elsewhere", () => {
    visit("/auth/sso/callback#token=AAA&refreshToken=RRR");
    takeUrlCredentials(["token", "refreshToken"] as const);
    visit("/dashboard");
    const replaceState = vi.spyOn(window.history, "replaceState");

    vi.runAllTimers();

    expect(replaceState).not.toHaveBeenCalled();
    expect(currentPath()).toBe("/dashboard");
  });
});
