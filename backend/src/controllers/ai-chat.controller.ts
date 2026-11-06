/**
 * AI Chat Controller
 * Handles chat API requests with streaming responses
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { AIChatService, ChatMessage } from '../services/ai-chat.service';
import { AIChatContextRepository } from '../repositories/ai-chat-context.repository';

/** Server-side history cap (founder decision A-D15): the newest messages kept, and the longest message accepted. */
export const CHAT_MAX_MESSAGES = 20;
export const CHAT_MAX_MESSAGE_CHARS = 8000;

const INVALID_MESSAGE_FORMAT = 'Invalid message format - each message must have role (user|assistant) and content';
const MESSAGE_TOO_LONG = `Each message must be at most ${CHAT_MAX_MESSAGE_CHARS.toLocaleString('en-US')} characters.`;

/**
 * Validates a client-sent history and applies the cap: every message must be
 * a non-empty user/assistant message of at most CHAT_MAX_MESSAGE_CHARS
 * characters (a longer one is refused, never silently cut), and only the
 * newest CHAT_MAX_MESSAGES are kept. The kept history starts at a user
 * message, as the model API requires.
 */
export function prepareChatHistory(messages: unknown[]): { ok: true; messages: ChatMessage[] } | { ok: false; error: string } {
  const valid = messages.every(
    (m: any) =>
      m &&
      typeof m.role === 'string' &&
      ['user', 'assistant'].includes(m.role) &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0
  );
  if (!valid) return { ok: false, error: INVALID_MESSAGE_FORMAT };
  const history = (messages as ChatMessage[]).map((m) => ({ role: m.role, content: m.content }));
  if (history.some((m) => m.content.length > CHAT_MAX_MESSAGE_CHARS)) return { ok: false, error: MESSAGE_TOO_LONG };

  const kept = history.slice(-CHAT_MAX_MESSAGES);
  const firstUser = kept.findIndex((m) => m.role === 'user');
  if (firstUser === -1) return { ok: false, error: INVALID_MESSAGE_FORMAT };
  return { ok: true, messages: kept.slice(firstUser) };
}

export class AIChatController {
  private chatService: AIChatService;
  private contextRepo: AIChatContextRepository;

  constructor(pool: Pool) {
    this.chatService = new AIChatService(pool);
    this.contextRepo = new AIChatContextRepository(pool);
  }

  /**
   * POST /api/ai-chat
   * Stream chat response using Server-Sent Events
   */
  chat = async (req: Request, res: Response) => {
    try {
      const { messages } = req.body;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - organization context required',
        });
      }

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Messages array is required and must not be empty',
        });
      }

      const history = prepareChatHistory(messages);
      if (!history.ok) {
        return res.status(400).json({ success: false, error: history.error });
      }

      console.log(`[AI Chat Controller] Processing chat for org: ${organizationId}`);
      console.log(`[AI Chat Controller] Message count: ${messages.length}`);

      // Gather AWS context for the organization
      const context = await this.contextRepo.gatherContext(organizationId);

      // Set headers for Server-Sent Events (SSE)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Stream response chunks
      for await (const chunk of this.chatService.chat(history.messages, context)) {
        // Send chunk as SSE data
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      // Signal completion
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      console.log('[AI Chat Controller] Stream complete');
    } catch (error: any) {
      console.error('[AI Chat Controller] Error:', error.message);

      // If headers already sent, we can't send JSON error
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: 'An error occurred' })}\n\n`);
        res.end();
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to process chat request',
        });
      }
    }
  };

  /**
   * POST /api/ai-chat/sync
   * Non-streaming chat for testing/debugging
   */
  chatSync = async (req: Request, res: Response) => {
    try {
      const { messages } = req.body;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - organization context required',
        });
      }

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Messages array is required',
        });
      }

      const history = prepareChatHistory(messages);
      if (!history.ok) {
        return res.status(400).json({ success: false, error: history.error });
      }

      console.log(`[AI Chat Controller] Sync chat for org: ${organizationId}`);

      const context = await this.contextRepo.gatherContext(organizationId);
      const response = await this.chatService.chatSync(history.messages, context);

      res.json({
        success: true,
        data: {
          response,
          // Counts are null (never 0) whenever their section isn't 'available';
          // the matching *State field says why.
          context: {
            services: context.services.state === 'available' ? context.services.data?.length ?? null : null,
            servicesState: context.services.state,
            currentCost: context.costs.current,
            costState: context.costs.state,
            costSource: context.costs.source,
            costDataAsOf: context.costs.asOf,
            resourceDataAsOf: context.discovery.data?.completedAt ?? null,
            alertCount: context.alerts.state === 'available' ? context.alerts.data?.total ?? null : null,
            alertState: context.alerts.state,
          },
        },
      });
    } catch (error: any) {
      console.error('[AI Chat Controller] Sync error:', error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  /**
   * GET /api/ai-chat/context
   * Get current AWS context (for debugging)
   */
  getContext = async (req: Request, res: Response) => {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      const context = await this.contextRepo.gatherContext(organizationId);

      res.json({
        success: true,
        data: context,
      });
    } catch (error: any) {
      // The raw message can carry database/infrastructure detail: log it, don't return it.
      console.error('[AI Chat Controller] Context error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to load AI context',
      });
    }
  };
}
