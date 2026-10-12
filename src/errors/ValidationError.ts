import { ApiError } from "./ApiError.js";

export class ValidationError extends ApiError {
  details?: unknown;

  constructor({
    code = "VALIDATION_ERROR",
    message,
    details,
  }: {
    code?: string;
    message: string;
    details?: unknown;
  }) {
    super({
      statusCode: 422,
      type: "validation_error",
      code,
      message,
    });
    this.details = details;
  }
}
