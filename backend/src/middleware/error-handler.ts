import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
import { AppError } from '../utils/errors';

/** Body-parser's error for a request body that is not valid JSON. */
function isJsonParseError(err: unknown): boolean {
  return (err as { type?: unknown } | null)?.type === 'entity.parse.failed';
}

/**
 * The fields of an error that are logged -- never the error object itself.
 * A JSON parse error's message and stack quote the request body, so a fixed
 * message stands in for both.
 */
function loggableError(err: Error | AppError) {
  const { type, status, statusCode } = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  const fields = {
    name: err.name,
    type: typeof type === 'string' ? type : undefined,
    status: typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : undefined,
  };
  return isJsonParseError(err)
    ? { ...fields, message: 'Invalid JSON body' }
    : { ...fields, message: err.message, stack: err.stack };
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error with timestamp
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error on ${req.method} ${req.path}:`, loggableError(err));

  // Determine status code and error code
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let errorMessage = 'Internal server error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    errorMessage = err.message;
  } else if (isJsonParseError(err)) {
    statusCode = 400;
    errorCode = 'INVALID_JSON';
    errorMessage = 'Invalid JSON body';
  } else {
    errorMessage = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;
  }

  const response: ApiResponse = {
    success: false,
    error: errorMessage,
    code: errorCode,
  };

  res.status(statusCode).json(response);
};

export const notFoundHandler = (
  req: Request,
  res: Response
): void => {
  const response: ApiResponse = {
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
  };

  res.status(404).json(response);
};
