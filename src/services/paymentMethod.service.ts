import { prisma } from "@/lib/prisma.js";
import { ForbiddenError } from "@/errors/ForbiddenError.js";
import { ConflictError } from "@/errors/ConflictError.js";
import { NotFoundError } from "@/errors/NotFoundError.js";
import { publishSyncEvent } from "@/lib/sync.js";
import type { CreatePaymentMethodInput } from "@/validators/paymentMethod.validator.js";

export const SYSTEM_PAYMENT_METHODS = [
  { name: "CASH", label: "Cash", icon: "Banknote" },
  { name: "CREDIT_CARD", label: "Credit Card", icon: "CreditCard" },
  { name: "DEBIT_CARD", label: "Debit Card", icon: "CreditCard" },
  { name: "BANK_TRANSFER", label: "Bank Transfer", icon: "Building2" },
  { name: "OTHER", label: "Other", icon: "MoreHorizontal" },
];

export const MAX_CUSTOM_PAYMENT_METHODS = 10;

export const getPaymentMethodsService = async (userId: string) => {
  const customPaymentMethods = await prisma.userPaymentMethod.findMany({
    where: {
      userId,
      isDeleted: false,
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    system: SYSTEM_PAYMENT_METHODS,
    custom: customPaymentMethods,
    quota: {
      customCount: customPaymentMethods.length,
      maxLimit: MAX_CUSTOM_PAYMENT_METHODS,
    },
  };
};

export const createPaymentMethodService = async (
  userId: string,
  input: CreatePaymentMethodInput,
  originClientId?: string,
) => {
  const paymentMethod = await prisma.$transaction(async (tx) => {
    const currentCount = await tx.userPaymentMethod.count({
      where: {
        userId,
        isDeleted: false,
        isSystem: false,
      },
    });

    if (currentCount >= MAX_CUSTOM_PAYMENT_METHODS) {
      throw new ForbiddenError({
        code: "QUOTA_EXCEEDED",
        message: `You have reached the limit of ${MAX_CUSTOM_PAYMENT_METHODS} custom payment methods. Delete an existing custom payment method to add a new one.`,
      });
    }

    const existing = await tx.userPaymentMethod.findFirst({
      where: {
        userId,
        name: { equals: input.name, mode: "insensitive" },
        isDeleted: false,
      },
    });

    if (existing) {
      throw new ConflictError({
        code: "PAYMENT_METHOD_EXISTS",
        message: `A payment method named "${input.name}" already exists.`,
      });
    }

    return await tx.userPaymentMethod.create({
      data: {
        userId,
        name: input.name,
        icon: input.icon,
        isSystem: false,
      },
    });
  });

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "PAYMENT_METHODS",
    originClientId,
    entityId: paymentMethod.id,
  });

  return paymentMethod;
};

export const deletePaymentMethodService = async (
  userId: string,
  id: string,
  originClientId?: string,
) => {
  const item = await prisma.userPaymentMethod.findFirst({
    where: {
      id,
      userId,
      isDeleted: false,
    },
  });

  if (!item) {
    throw new NotFoundError({
      code: "PAYMENT_METHOD_NOT_FOUND",
      message: "Custom payment method not found.",
    });
  }

  if (item.isSystem) {
    throw new ForbiddenError({
      code: "SYSTEM_PAYMENT_METHOD_PROTECTED",
      message: "System payment methods cannot be deleted.",
    });
  }

  const deletedItem = await prisma.$transaction(async (tx) => {
    const deleted = await tx.userPaymentMethod.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: userId,
      },
    });

    const settings = await tx.userSettings.findUnique({
      where: { userId },
    });

    if (
      settings &&
      settings.defaultPaymentMethod &&
      settings.defaultPaymentMethod.toLowerCase() === item.name.toLowerCase()
    ) {
      await tx.userSettings.update({
        where: { userId },
        data: {
          defaultPaymentMethod: null,
        },
      });
    }

    return deleted;
  });

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "PAYMENT_METHODS",
    originClientId,
    entityId: id,
  });

  return deletedItem;
};
