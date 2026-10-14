import type { Request, Response } from "express";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import {
  getReflectReportService,
  generateReflectReportService,
  chatReflectService,
} from "@/services/reflect.service.js";
import type {
  GenerateReflectInput,
  GetReflectQueryInput,
  ChatReflectInput,
} from "@/validators/reflect.validator.js";

export const getReflectReportController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetReflectQueryInput;
  const result = await getReflectReportService(req.user.id, query);
  return res.success("Reflect report fetched successfully.", result, 200);
};

export const generateReflectReportController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const result = await generateReflectReportService(
    req.user.id,
    req.body as GenerateReflectInput,
    originClientId,
  );
  return res.success("Reflect report generated successfully.", result, 201);
};

export const chatReflectController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const result = await chatReflectService(
    req.user.id,
    req.body as ChatReflectInput,
    originClientId,
  );
  return res.success("Chat response generated successfully.", result, 200);
};
