import { ApiError } from "./ApiError.js";

export class NotFoundError extends ApiError {
  constructor({ code, message }: { code: string; message: string }) {
    super({
      statusCode: 404,
      code,
      message,
    });
  }
}
