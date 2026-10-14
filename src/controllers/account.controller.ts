import type { Request, Response } from "express";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import {
  changePasswordService,
  getSessionsService,
  revokeSessionService,
  revokeOtherSessionsService,
  exportUserDataService,
  deleteAccountService,
} from "@/services/account.service.js";
import type {
  ChangePasswordInput,
  DeleteAccountInput,
} from "@/validators/profile.validator.js";

export const changePasswordController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const result = await changePasswordService(
    req.user.id,
    req.body as ChangePasswordInput,
    req.user.sessionId,
  );

  return res.success(result.message, null, 200);
};

export const getSessionsController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const result = await getSessionsService(req.user.id, req.user.sessionId);
  return res.success("Active sessions retrieved successfully.", result, 200);
};

export const revokeSessionController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const { sessionId } = req.params as { sessionId: string };
  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const result = await revokeSessionService(
    req.user.id,
    sessionId,
    req.user.sessionId,
    originClientId,
  );

  return res.success("Session revoked successfully.", result, 200);
};

export const revokeOtherSessionsController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const result = await revokeOtherSessionsService(
    req.user.id,
    req.user.sessionId,
    originClientId,
  );

  return res.success("All other sessions revoked successfully.", result, 200);
};

export const exportUserDataController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const format = (req.query.format as "json" | "csv") || "json";
  const result = await exportUserDataService(req.user.id, format);

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);

  if (format === "csv") {
    return res.status(200).send(result.data);
  }

  return res.status(200).send(JSON.stringify(result.data, null, 2));
};

export const deleteAccountController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const result = await deleteAccountService(
    req.user.id,
    req.body as DeleteAccountInput,
  );

  return res.success(result.message, null, 200);
};

