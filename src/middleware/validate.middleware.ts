import type { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ValidationError } from "@/errors/ValidationError.js";

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export const validateRequest = (schemas: ZodSchema | ValidationSchemas) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if ("parse" in schemas) {
        req.body = schemas.parse(req.body);
      } else {
        if (schemas.body) {
          req.body = schemas.body.parse(req.body);
        }
        if (schemas.query) {
          const parsedQuery = schemas.query.parse(req.query);
          Object.defineProperty(req, "query", {
            value: parsedQuery,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        }
        if (schemas.params) {
          const parsedParams = schemas.params.parse(req.params);
          Object.defineProperty(req, "params", {
            value: parsedParams,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        }
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        return next(
          new ValidationError({
            message: "Request validation failed.",
            details,
          }),
        );
      }
      next(error);
    }
  };
};
