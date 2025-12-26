import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
import { AppError } from '../utils/errors';

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error with timestamp
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error on ${req.method} ${req.path}:`, {
    message: err.message,
    stack: err.stack,
    ...(err instanceof AppError && { code: err.code, statusCode: err.statusCode }),
  });

  // Determine status code and error code
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let errorMessage = 'Internal server error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    errorMessage = err.message;
  } else {
    // Log unexpected errors with full stack trace
    console.error('Unexpected error:', err);
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
