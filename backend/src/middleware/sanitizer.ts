/**
 * Input Sanitization Middleware
 * Prevents XSS attacks by sanitizing user input
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Sanitize a string to prevent XSS attacks
 * Converts HTML special characters to their entity equivalents
 */
function sanitizeString(str: string): string {
  if (typeof str !== 'string') return str;

  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Recursively sanitize an object
 * Handles nested objects and arrays
 */
function sanitizeObject(obj: any): any {
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle strings
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  // Handle objects
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  // Return other types as-is (numbers, booleans, etc.)
  return obj;
}

/**
 * Fields that should NOT be sanitized
 * (e.g., password fields, hashed values, etc.)
 */
const SKIP_SANITIZATION_FIELDS = [
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'accessToken',
  'hash',
];

/**
 * Check if a field should be skipped during sanitization
 */
function shouldSkipField(fieldPath: string): boolean {
  return SKIP_SANITIZATION_FIELDS.some(skipField =>
    fieldPath.toLowerCase().includes(skipField.toLowerCase())
  );
}

/**
 * Sanitize object but skip certain fields
 */
function sanitizeObjectSelective(obj: any, parentKey: string = ''): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return shouldSkipField(parentKey) ? obj : sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) =>
      sanitizeObjectSelective(item, `${parentKey}[${index}]`)
    );
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const fieldPath = parentKey ? `${parentKey}.${key}` : key;
        sanitized[key] = sanitizeObjectSelective(obj[key], fieldPath);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitizer Middleware
 * Sanitizes request body and query parameters to prevent XSS
 */
export function sanitizerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObjectSelective(req.body);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObjectSelective(req.query);
    }

    // Note: We don't sanitize req.params as they're typically controlled by routes
    // and should be validated with specific schemas instead

    next();
  } catch (error) {
    console.error('Error in sanitizer middleware:', error);
    // Don't block the request if sanitization fails, but log it
    next();
  }
}

/**
 * Strict sanitizer for high-risk endpoints
 * Applies more aggressive sanitization
 */
export function strictSanitizerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Remove all HTML tags completely for strict mode
    const stripHtml = (str: string): string => {
      if (typeof str !== 'string') return str;
      return str.replace(/<[^>]*>/g, '');
    };

    const sanitizeStrict = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'string') return stripHtml(sanitizeString(obj));
      if (Array.isArray(obj)) return obj.map(sanitizeStrict);
      if (obj && typeof obj === 'object') {
        const sanitized: any = {};
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            sanitized[key] = sanitizeStrict(obj[key]);
          }
        }
        return sanitized;
      }
      return obj;
    };

    if (req.body) {
      req.body = sanitizeStrict(req.body);
    }
    if (req.query) {
      req.query = sanitizeStrict(req.query);
    }

    next();
  } catch (error) {
    console.error('Error in strict sanitizer middleware:', error);
    next();
  }
}

// Export individual sanitization functions for manual use
export { sanitizeString, sanitizeObject, sanitizeObjectSelective };
