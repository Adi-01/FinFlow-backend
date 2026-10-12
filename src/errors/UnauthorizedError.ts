import { ApiError } from "./ApiError.js";

export class UnauthorizedError extends ApiError {
  constructor({ code, message }: { code: string; message: string }) {
    super({
      statusCode: 401,
      code,
      message,
    });
  }
}
