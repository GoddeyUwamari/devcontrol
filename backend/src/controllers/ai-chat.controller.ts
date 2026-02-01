/**
 * AI Chat Controller
 * Handles chat API requests with streaming responses
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { AIChatService, ChatMessage } from '../services/ai-chat.service';
import { AIChatContextRepository } from '../repositories/ai-chat-context.repository';

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

      // Validate message format
      const validMessages = messages.every(
        (m: any) =>
          m &&
          typeof m.role === 'string' &&
          ['user', 'assistant'].includes(m.role) &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
      );

      if (!validMessages) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message format - each message must have role (user|assistant) and content',
        });
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
      for await (const chunk of this.chatService.chat(messages as ChatMessage[], context)) {
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

      console.log(`[AI Chat Controller] Sync chat for org: ${organizationId}`);

      const context = await this.contextRepo.gatherContext(organizationId);
      const response = await this.chatService.chatSync(messages as ChatMessage[], context);

      res.json({
        success: true,
        data: {
          response,
          context: {
            services: context.services.length,
            currentCost: context.costs.current,
            alertCount: context.alerts.total,
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
      console.error('[AI Chat Controller] Context error:', error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };
}
