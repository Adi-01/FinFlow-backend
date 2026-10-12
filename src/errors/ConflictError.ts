import { ApiError } from "./ApiError.js";

export class ConflictError extends ApiError {
  constructor({ code, message }: { code: string; message: string }) {
    super({
      statusCode: 409,
      code,
      message,
    });
  }
}
