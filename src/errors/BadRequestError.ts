import { ApiError } from "./ApiError.js";

export class BadRequestError extends ApiError {
  constructor({ code, message }: { code: string; message: string }) {
    super({
      statusCode: 400,
      code,
      message,
    });
  }
}
