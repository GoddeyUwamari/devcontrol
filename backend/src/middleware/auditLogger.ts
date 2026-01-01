/**
 * Audit Logger Middleware
 * Logs all API actions to the audit_logs table with batching for performance
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

// Extend Express Request type to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        organizationId: string;
        role: string;
      };
      organizationId?: string;
    }
  }
}

interface AuditLogEntry {
  organizationId: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

// In-memory batch buffer
let auditLogBuffer: AuditLogEntry[] = [];
const BATCH_INTERVAL = 5000; // 5 seconds
const MAX_BATCH_SIZE = 100;

/**
 * Flush audit logs to database
 */
const flushAuditLogs = async (): Promise<void> => {
  if (auditLogBuffer.length === 0) return;

  const logsToFlush = [...auditLogBuffer];
  auditLogBuffer = [];

  try {
    // Build bulk insert query
    const values: any[] = [];
    const placeholders: string[] = [];

    logsToFlush.forEach((log, index) => {
      const baseIndex = index * 9;
      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9})`
      );
      values.push(
        log.organizationId,
        log.userId,
        log.action,
        log.resourceType,
        log.resourceId,
        log.ipAddress,
        log.userAgent,
        JSON.stringify(log.metadata),
        log.timestamp
      );
    });

    const query = `
      INSERT INTO audit_logs (
        organization_id, user_id, action, resource_type, resource_id,
        ip_address, user_agent, metadata, created_at
      ) VALUES ${placeholders.join(', ')}
    `;

    await pool.query(query, values);
    console.log(`✅ Flushed ${logsToFlush.length} audit logs to database`);
  } catch (error) {
    console.error('❌ Failed to flush audit logs:', error);
    // Put logs back in buffer to retry
    auditLogBuffer = [...logsToFlush, ...auditLogBuffer];
  }
};

// Start batch flush interval
setInterval(flushAuditLogs, BATCH_INTERVAL);

// Flush on process exit
process.on('beforeExit', () => {
  flushAuditLogs();
});

/**
 * Determine action type from request
 */
const determineAction = (req: Request, res: Response): string | null => {
  const { method, path } = req;
  const statusCode = res.statusCode;

  // Auth actions
  if (path.includes('/auth/login')) {
    return statusCode === 200 ? 'auth.login' : 'auth.failed';
  }
  if (path.includes('/auth/logout')) {
    return 'auth.logout';
  }
  if (path.includes('/auth/register')) {
    return statusCode === 201 ? 'auth.register' : 'auth.register_failed';
  }

  // Resource discovery actions
  if (path.includes('/aws/resources/discover') && method === 'POST') {
    return 'resource.discovered';
  }
  if (path.includes('/aws/resources') && method === 'POST') {
    return 'resource.created';
  }
  if (path.includes('/aws/resources') && method === 'DELETE') {
    return 'resource.deleted';
  }
  if (path.includes('/aws/resources') && method === 'PATCH' && path.includes('/tags')) {
    return 'resource.tagged';
  }

  // Settings actions
  if (path.includes('/settings/aws') && method === 'PUT') {
    return 'settings.aws_updated';
  }
  if (path.includes('/users') && method === 'POST') {
    return 'settings.user_added';
  }
  if (path.includes('/users') && method === 'DELETE') {
    return 'settings.user_removed';
  }

  // Service actions
  if (path.includes('/services') && method === 'POST') {
    return 'service.created';
  }
  if (path.includes('/services') && method === 'PUT') {
    return 'service.updated';
  }
  if (path.includes('/services') && method === 'DELETE') {
    return 'service.deleted';
  }

  // Deployment actions
  if (path.includes('/deployments') && method === 'POST') {
    return 'deployment.created';
  }
  if (path.includes('/deployments') && method === 'PUT') {
    return 'deployment.updated';
  }

  // Only log significant actions
  return null;
};

/**
 * Check if a string is a valid UUID
 */
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Extract resource information from request
 */
const extractResourceInfo = (req: Request): { type: string | null; id: string | null } => {
  const { path, body, params } = req;

  // Extract from URL params
  if (params.id && isValidUUID(params.id)) {
    if (path.includes('/services')) return { type: 'service', id: params.id };
    if (path.includes('/deployments')) return { type: 'deployment', id: params.id };
    if (path.includes('/aws/resources')) return { type: 'aws_resource', id: params.id };
    if (path.includes('/users')) return { type: 'user', id: params.id };
  }

  // Extract from request body
  if (body?.id || body?.resourceId) {
    const id = body.id || body.resourceId;
    if (isValidUUID(id)) {
      if (path.includes('/services')) return { type: 'service', id };
      if (path.includes('/deployments')) return { type: 'deployment', id };
      if (path.includes('/aws/resources')) return { type: 'aws_resource', id };
    }
  }

  return { type: null, id: null };
};

/**
 * Audit logger middleware
 */
export const auditLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();

  // Capture response end
  const originalSend = res.send;
  res.send = function (data): Response {
    res.send = originalSend; // Restore original send

    // Determine if we should log this action
    const action = determineAction(req, res);

    if (action) {
      // Get IP address
      const ipAddress = (
        req.headers['x-forwarded-for'] as string ||
        req.socket.remoteAddress ||
        'unknown'
      ).toString().split(',')[0].trim();

      // Get user agent
      const userAgent = req.headers['user-agent'] || 'unknown';

      // Build metadata
      const metadata: Record<string, any> = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: Date.now() - startTime,
      };

      // Add relevant request body fields (sanitized)
      if (req.body && Object.keys(req.body).length > 0) {
        const sanitizedBody = { ...req.body };
        // Remove sensitive fields
        delete sanitizedBody.password;
        delete sanitizedBody.accessKey;
        delete sanitizedBody.secretKey;
        delete sanitizedBody.token;
        metadata.requestBody = sanitizedBody;
      }

      // For auth actions, try to extract organizationId from response or set default
      let organizationId = req.user?.organizationId;
      let userId = req.user?.userId || null;

      // For login success, extract from response body
      if (action === 'auth.login' && res.statusCode === 200) {
        try {
          const responseData = JSON.parse(data.toString());
          if (responseData?.data?.user?.organizationId) {
            organizationId = responseData.data.user.organizationId;
            userId = responseData.data.user.id;
          }
        } catch (err) {
          // If parsing fails, log will be skipped below
        }
      }

      // Skip if we don't have an organization context
      if (!organizationId) {
        return originalSend.call(this, data);
      }

      const { type: resourceType, id: resourceId } = extractResourceInfo(req);

      // Create audit log entry
      const logEntry: AuditLogEntry = {
        organizationId,
        userId,
        action,
        resourceType,
        resourceId,
        ipAddress,
        userAgent,
        metadata,
        timestamp: new Date(),
      };

      // Add to buffer
      auditLogBuffer.push(logEntry);

      // Flush immediately if buffer is full
      if (auditLogBuffer.length >= MAX_BATCH_SIZE) {
        flushAuditLogs().catch(err => {
          console.error('Failed to flush audit logs:', err);
        });
      }
    }

    return originalSend.call(this, data);
  };

  next();
};

// Export flush function for testing
export { flushAuditLogs };
