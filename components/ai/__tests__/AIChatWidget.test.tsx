import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AIChatWidget } from "../AIChatWidget";

// The widget only needs the service module to exist -- no message is sent
// in this test, so sendMessage is never actually invoked.
vi.mock("@/lib/services/ai-chat.service", () => ({
  aiChatService: { sendMessage: vi.fn() },
}));

describe("AIChatWidget -- truthful freshness wording", () => {
  it("does not claim real-time AWS data access", async () => {
    render(<AIChatWidget />);

    fireEvent.click(screen.getByRole("button", { name: /open ai assistant/i }));

    expect(screen.queryByText(/real-time AWS data/i)).not.toBeInTheDocument();
    expect(screen.getByText(/latest synced AWS cost and resource data/i)).toBeInTheDocument();
  });
});
