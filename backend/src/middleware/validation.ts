import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ValidationError } from '../utils/errors';

/**
 * Middleware to validate request body against a Zod schema
 */
export const validateBody = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessage = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        next(new ValidationError(errorMessage));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Middleware to validate query parameters against a Zod schema
 */
export const validateQuery = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = await schema.parseAsync(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessage = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        next(new ValidationError(errorMessage));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Middleware to validate route parameters against a Zod schema
 */
export const validateParams = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = await schema.parseAsync(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessage = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        next(new ValidationError(errorMessage));
      } else {
        next(error);
      }
    }
  };
};
