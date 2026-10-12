import { ApiError } from "./ApiError.js";

export class ForbiddenError extends ApiError {
  constructor({ code, message }: { code: string; message: string }) {
    super({
      statusCode: 403,
      code,
      message,
    });
  }
}
