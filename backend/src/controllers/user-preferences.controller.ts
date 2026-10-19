/**
 * User Preferences Controller
 * Handles email notification preferences
 */

import { NextFunction, Request, Response } from 'express';
import { pool } from '../config/database';
import { presentedUnsubscribeToken, verifyUnsubscribeToken } from '../services/unsubscribe-token';

interface EmailPreferences {
  weeklySummary: boolean;
  anomalyAlerts: boolean;
  costAlerts: boolean;
  deploymentAlerts: boolean;
}

/**
 * Get user's email preferences
 */
export async function getEmailPreferences(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const result = await pool.query(
      `SELECT
        email_weekly_summary as "weeklySummary",
        email_anomaly_alerts as "anomalyAlerts",
        email_cost_alerts as "costAlerts",
        email_deployment_alerts as "deploymentAlerts"
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('[User Preferences] Get error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch email preferences'
    });
  }
}

/**
 * Update user's email preferences
 */
export async function updateEmailPreferences(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const preferences: Partial<EmailPreferences> = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Map camelCase to snake_case and validate
    const fieldMap: Record<string, string> = {
      weeklySummary: 'email_weekly_summary',
      anomalyAlerts: 'email_anomaly_alerts',
      costAlerts: 'email_cost_alerts',
      deploymentAlerts: 'email_deployment_alerts'
    };

    for (const [key, value] of Object.entries(preferences)) {
      if (key in fieldMap && typeof value === 'boolean') {
        updates.push(`${fieldMap[key]} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid preferences provided'
      });
    }

    // Add timestamp and user ID
    updates.push(`email_preferences_updated_at = NOW()`);
    values.push(userId);

    const query = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING
        email_weekly_summary as "weeklySummary",
        email_anomaly_alerts as "anomalyAlerts",
        email_cost_alerts as "costAlerts",
        email_deployment_alerts as "deploymentAlerts",
        email_preferences_updated_at as "updatedAt"
    `;

    const result = await pool.query(query, values);

    console.log(`[User Preferences] Updated for user ${userId}:`, preferences);

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Email preferences updated successfully'
    });

  } catch (error: any) {
    console.error('[User Preferences] Update error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update email preferences'
    });
  }
}

/**
 * Get user's display preferences (theme, timezone, language)
 */
export async function getDisplayPreferences(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT theme, timezone, language FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    console.error('[Display Preferences] Get error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch display preferences' });
  }
}

/**
 * Update user's display preferences (theme, timezone, language)
 */
export async function updateDisplayPreferences(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { theme, timezone, language } = req.body;

    const allowed = { theme: 'theme', timezone: 'timezone', language: 'language' };
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (theme !== undefined && typeof theme === 'string') {
      updates.push(`theme = $${paramCount++}`);
      values.push(theme);
    }
    if (timezone !== undefined && typeof timezone === 'string') {
      updates.push(`timezone = $${paramCount++}`);
      values.push(timezone);
    }
    if (language !== undefined && typeof language === 'string') {
      updates.push(`language = $${paramCount++}`);
      values.push(language);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid preferences provided' });
    }

    values.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING theme, timezone, language`,
      values
    );

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Display preferences updated successfully',
    });
  } catch (error: any) {
    console.error('[Display Preferences] Update error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update display preferences' });
  }
}

/*
 * Weekly summary unsubscribe (email link). Public: CAN-SPAM requires it to
 * work without login. Tokens come from services/unsubscribe-token.ts.
 *
 *   GET  ?token=...        confirmation page only -- never changes state, so
 *                          mail scanners that pre-open links unsubscribe nobody
 *   POST body token=...    the confirm page's button; signed tokens, and legacy
 *                          base64(userId) tokens until LEGACY_UNSUBSCRIBE_CUTOFF
 *   POST ?token=...        RFC 8058 one-click from the mail client
 *                          (body List-Unsubscribe=One-Click); signed tokens only
 *
 * Only email_weekly_summary is turned off; everything else is managed at
 * /settings/notifications. A valid token gets the same response whether or
 * not the user exists, and every rejected token gets the same generic page.
 * Logs never carry the token or the email address.
 */

const UNSUBSCRIBE_PURPOSE = 'weekly-summary' as const;
const INVALID_LINK_TEXT = 'This unsubscribe link is invalid or has expired.';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** The message only: never the request, token or full error object. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function preferencesUrl(): string {
  return `${process.env.FRONTEND_URL || 'http://localhost:3010'}/settings/notifications`;
}

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)} - DevControl</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; background: #f9fafb; }
    .container { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
    h1 { color: #1f2937; margin: 0 0 10px; font-size: 26px; }
    p { color: #6b7280; line-height: 1.6; margin: 15px 0; }
    a { color: #635BFF; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    button { background: #635BFF; color: white; border: 0; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 10px; }
    button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="container">
${body}
  </div>
</body>
</html>`;
}

function confirmPage(token: string, action: string): string {
  return renderPage('Unsubscribe', `
    <h1>Unsubscribe from weekly summary emails?</h1>
    <p>You'll stop receiving the DevControl weekly summary email.</p>
    <form method="POST" action="${escapeHtml(action)}">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit">Unsubscribe</button>
    </form>
    <p>To manage other email notifications, go to <a href="${escapeHtml(preferencesUrl())}">email preferences</a>.</p>`);
}

function unsubscribedPage(): string {
  return renderPage('Unsubscribed', `
    <h1>You've been unsubscribed from weekly summary emails</h1>
    <p>You'll no longer receive the DevControl weekly summary email.</p>
    <p>To turn it back on or manage other email notifications, go to <a href="${escapeHtml(preferencesUrl())}">email preferences</a>.</p>`);
}

function invalidLinkPage(): string {
  return renderPage('Invalid link', `
    <h1>Invalid link</h1>
    <p>${INVALID_LINK_TEXT}</p>
    <p>Sign in to manage your <a href="${escapeHtml(preferencesUrl())}">email preferences</a>.</p>`);
}

function errorPage(): string {
  return renderPage('Error', `
    <h1>Something went wrong</h1>
    <p>We couldn't process your request. Please try again later.</p>`);
}

/** no-store / noindex / no-referrer on every unsubscribe response, including 429s. */
export function unsubscribeResponseHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  });
  next();
}

/**
 * GET: the confirmation page. Reads nothing from the database and changes
 * nothing; the token moves into the form body so it never reappears in a URL.
 */
export async function showUnsubscribeConfirm(req: Request, res: Response) {
  try {
    const { token } = presentedUnsubscribeToken(req);
    const verified = verifyUnsubscribeToken(token, UNSUBSCRIBE_PURPOSE);
    if (verified.kind === 'invalid') {
      return res.status(400).send(invalidLinkPage());
    }
    return res.send(confirmPage(token as string, `${req.baseUrl}${req.path}`));
  } catch (error: unknown) {
    console.error('[Unsubscribe] Confirm page error:', errorMessage(error));
    return res.status(500).send(errorPage());
  }
}

/**
 * POST: turn off the weekly summary, from the confirm page's form or an
 * RFC 8058 one-click request (signed tokens only); see
 * presentedUnsubscribeToken for which is which.
 */
export async function confirmUnsubscribe(req: Request, res: Response) {
  const { token, oneClick } = presentedUnsubscribeToken(req);
  const mode = oneClick ? 'one-click' : 'confirm page';
  try {
    const verified = verifyUnsubscribeToken(token, UNSUBSCRIBE_PURPOSE);

    // Legacy tokens are forgeable (base64 of the user id), so they are only
    // accepted from the human confirm page, never from one-click.
    if (verified.kind === 'invalid' || (oneClick && verified.kind === 'legacy')) {
      console.warn(`[Unsubscribe] Rejected ${mode} request: invalid or expired token`);
      return oneClick
        ? res.status(400).type('text/plain').send(INVALID_LINK_TEXT)
        : res.status(400).send(invalidLinkPage());
    }

    // Already-off rows are left alone, so a repeat changes nothing.
    const result = await pool.query(
      `UPDATE users
       SET email_weekly_summary = false,
           email_preferences_updated_at = NOW()
       WHERE id = $1 AND email_weekly_summary IS DISTINCT FROM false`,
      [verified.userId]
    );
    console.log(
      `[Unsubscribe] Weekly summary unsubscribe for user ${verified.userId} ` +
        `(${verified.kind} token, ${mode}, ${result.rowCount ?? 0} row updated)`
    );
    return oneClick
      ? res.type('text/plain').send('Unsubscribed from weekly summary emails.')
      : res.send(unsubscribedPage());
  } catch (error: unknown) {
    console.error(`[Unsubscribe] ${mode} error:`, errorMessage(error));
    return oneClick
      ? res.status(500).type('text/plain').send('Something went wrong. Please try again later.')
      : res.status(500).send(errorPage());
  }
}
