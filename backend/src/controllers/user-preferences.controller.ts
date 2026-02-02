/**
 * User Preferences Controller
 * Handles email notification preferences
 */

import { Request, Response } from 'express';
import { pool } from '../config/database';

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
 * Unsubscribe from all emails (via email link)
 * CAN-SPAM Act compliance
 */
export async function unsubscribeAll(req: Request, res: Response) {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error - DevControl</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #dc2626; }
            p { color: #6b7280; }
          </style>
        </head>
        <body>
          <h1>❌ Invalid Link</h1>
          <p>This unsubscribe link is invalid or has expired.</p>
        </body>
        </html>
      `);
    }

    // Decode token to get user ID
    // Token is base64 encoded user ID
    let userId: string;
    try {
      userId = Buffer.from(token, 'base64').toString('utf-8');
    } catch (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error - DevControl</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #dc2626; }
            p { color: #6b7280; }
          </style>
        </head>
        <body>
          <h1>❌ Invalid Token</h1>
          <p>This unsubscribe link is malformed.</p>
        </body>
        </html>
      `);
    }

    const result = await pool.query(
      `UPDATE users
       SET email_weekly_summary = false,
           email_anomaly_alerts = false,
           email_cost_alerts = false,
           email_deployment_alerts = false,
           email_preferences_updated_at = NOW()
       WHERE id = $1
       RETURNING email`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error - DevControl</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #dc2626; }
            p { color: #6b7280; }
          </style>
        </head>
        <body>
          <h1>❌ User Not Found</h1>
          <p>We couldn't find a user associated with this link.</p>
        </body>
        </html>
      `);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010';
    console.log(`[Unsubscribe] User ${userId} (${result.rows[0].email}) unsubscribed from all emails`);

    // Return success page
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Unsubscribed - DevControl</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            max-width: 600px;
            margin: 100px auto;
            padding: 20px;
            text-align: center;
            background: #f9fafb;
          }
          .container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          h1 {
            color: #1f2937;
            margin: 20px 0 10px;
            font-size: 28px;
          }
          .icon {
            font-size: 64px;
            margin-bottom: 10px;
          }
          p {
            color: #6b7280;
            line-height: 1.6;
            margin: 15px 0;
          }
          a {
            color: #635BFF;
            text-decoration: none;
            font-weight: 600;
          }
          a:hover {
            text-decoration: underline;
          }
          .button {
            display: inline-block;
            background: #635BFF;
            color: white !important;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            margin-top: 20px;
            font-weight: 600;
          }
          .button:hover {
            background: #4f46e5;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✅</div>
          <h1>You've been unsubscribed</h1>
          <p>You will no longer receive email notifications from DevControl.</p>
          <p>We're sorry to see you go, but we respect your decision.</p>
          <p>You can change your email preferences anytime in your account settings.</p>
          <a href="${frontendUrl}/settings/notifications" class="button">Manage Email Preferences</a>
          <p style="margin-top: 30px; font-size: 14px;">
            <a href="${frontendUrl}">Return to Dashboard</a>
          </p>
        </div>
      </body>
      </html>
    `);

  } catch (error: any) {
    console.error('[Unsubscribe] Error:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - DevControl</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
          h1 { color: #dc2626; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <h1>❌ Something went wrong</h1>
        <p>We encountered an error processing your request. Please try again later.</p>
      </body>
      </html>
    `);
  }
}
