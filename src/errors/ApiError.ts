export class ApiError extends Error {
  statusCode: number;
  type: string;
  code: string;

  constructor({
    statusCode,
    type = "api_error",
    code,
    message,
  }: {
    statusCode: number;
    type?: string;
    code: string;
    message: string;
  }) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.type = type;
    this.code = code;
  }
}
