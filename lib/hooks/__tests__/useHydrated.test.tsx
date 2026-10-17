/**
 * useHydrated: false in server HTML and during hydration (so the markup
 * matches), true straight after hydration and on client-only renders.
 */
import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot } from "react-dom/client";
import { useHydrated } from "../useHydrated";

function Probe() {
  return <span data-hydrated={String(useHydrated())} />;
}

describe("useHydrated", () => {
  it("is false in server-rendered HTML", () => {
    expect(renderToString(<Probe />)).toContain('data-hydrated="false"');
  });

  it("hydrates without a mismatch, then becomes true", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    const onRecoverableError = vi.fn();

    const root = await act(async () => hydrateRoot(container, <Probe />, { onRecoverableError }));

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("span")?.getAttribute("data-hydrated")).toBe("true");
    act(() => root.unmount());
  });

  it("is true on a client-only render", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(<Probe />));

    expect(container.querySelector("span")?.getAttribute("data-hydrated")).toBe("true");
    act(() => root.unmount());
  });
});
