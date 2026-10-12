import { ApiError } from "./ApiError.js";

export class UnprocessableEntityError extends ApiError {
  details?: Record<string, unknown> | undefined;

  constructor({
    code,
    message,
    details,
  }: {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
  }) {
    super({
      statusCode: 422,
      code,
      message,
    });
    if (details !== undefined) {
      this.details = details;
    }
  }
}
