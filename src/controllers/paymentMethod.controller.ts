import type { Request, Response } from "express";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import {
  getPaymentMethodsService,
  createPaymentMethodService,
  deletePaymentMethodService,
} from "@/services/paymentMethod.service.js";
import type { CreatePaymentMethodInput } from "@/validators/paymentMethod.validator.js";

export const getPaymentMethodsController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const data = await getPaymentMethodsService(req.user.id);
  return res.success("Payment methods fetched successfully.", data, 200);
};

export const createPaymentMethodController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const paymentMethod = await createPaymentMethodService(
    req.user.id,
    req.body as CreatePaymentMethodInput,
    originClientId,
  );
  return res.success("Payment method created successfully.", paymentMethod, 201);
};

export const deletePaymentMethodController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const { id } = req.params;
  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  await deletePaymentMethodService(req.user.id, id as string, originClientId);
  return res.success("Payment method deleted successfully.", null, 200);
};
