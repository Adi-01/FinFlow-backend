import { prisma } from "@/lib/prisma.js";
import { NotFoundError } from "@/errors/NotFoundError.js";
import { BadRequestError } from "@/errors/BadRequestError.js";
import { redis } from "@/lib/redis.js";
import {
  uploadImageStream,
  deleteCloudinaryImage,
} from "@/lib/cloudinary.js";
import { publishSyncEvent } from "@/lib/sync.js";
import type { UpdateProfileInput } from "@/validators/profile.validator.js";

export const getProfileService = async (userId: string) => {
  let user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
    include: {
      settings: true,
      categories: {
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
          type: true,
          icon: true,
          color: true,
          isSystem: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      paymentMethods: {
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
          icon: true,
          isSystem: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError({
      code: "USER_NOT_FOUND",
      message: "User account not found.",
    });
  }

  // Self-heal missing settings for legacy users
  let userSettings = user.settings;
  if (!userSettings) {
    userSettings = await prisma.userSettings.create({
      data: {
        userId,
        currencySymbol: "",
      },
    });
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    dob: user.dob,
    profileImage: user.profileImage ?? null,
    isOnboarding: user.isOnboarding,
    joinedAt: user.createdAt,
    settings: {
      currencySymbol: userSettings.currencySymbol || "",
      monthlyStartingAllowance: userSettings.monthlyStartingAllowance ?? 0,
      defaultPaymentMethod: userSettings.defaultPaymentMethod ?? null,
      selectedMonth: userSettings.selectedMonth ?? null,
    },
    categories: user.categories,
    paymentMethods: user.paymentMethods,
  };
};

export const updateProfileService = async (
  userId: string,
  input: UpdateProfileInput,
  originClientId?: string,
) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
    include: {
      settings: true,
    },
  });

  if (!user) {
    throw new NotFoundError({
      code: "USER_NOT_FOUND",
      message: "User account not found.",
    });
  }

  // 1. Enforce Post-Onboarding Immutability Rules
  if (!user.isOnboarding) {
    if (input.isOnboarding === true) {
      throw new BadRequestError({
        code: "ONBOARDING_ALREADY_COMPLETED",
        message: "Onboarding cannot be re-enabled once completed.",
      });
    }

    if (input.currencySymbol !== undefined && input.currencySymbol.trim() === "") {
      throw new BadRequestError({
        code: "INVALID_CURRENCY_SYMBOL",
        message: "Currency symbol cannot be empty once onboarding is complete.",
      });
    }

    if (input.dob === null) {
      throw new BadRequestError({
        code: "INVALID_DOB",
        message: "Date of birth cannot be removed once onboarding is complete.",
      });
    }
  }

  // Validate default payment method if supplied
  if (
    input.defaultPaymentMethod !== undefined &&
    input.defaultPaymentMethod !== null &&
    input.defaultPaymentMethod.trim() !== ""
  ) {
    const trimmedMethod = input.defaultPaymentMethod.trim();
    const systemMethodNames = [
      "CASH",
      "CREDIT_CARD",
      "DEBIT_CARD",
      "BANK_TRANSFER",
      "OTHER",
    ];
    const isSystem = systemMethodNames.some(
      (m) => m.toLowerCase() === trimmedMethod.toLowerCase(),
    );

    if (!isSystem) {
      const customExists = await prisma.userPaymentMethod.findFirst({
        where: {
          userId,
          name: { equals: trimmedMethod, mode: "insensitive" },
          isDeleted: false,
        },
      });

      if (!customExists) {
        throw new BadRequestError({
          code: "INVALID_DEFAULT_PAYMENT_METHOD",
          message: "Selected default payment method is invalid or no longer exists.",
        });
      }
    }
  }

  // 2. Resolve Effective Onboarding State
  const effectiveDob =
    input.dob !== undefined
      ? input.dob
        ? new Date(input.dob)
        : null
      : user.dob;

  const effectiveCurrencySymbol =
    input.currencySymbol !== undefined
      ? input.currencySymbol.trim()
      : user.settings?.currencySymbol || "";

  let resolvedIsOnboarding = user.isOnboarding;

  if (user.isOnboarding) {
    // If user has provided both valid DOB and non-empty currency symbol, auto-complete onboarding
    if (effectiveDob !== null && effectiveCurrencySymbol !== "") {
      resolvedIsOnboarding = false;
    } else if (input.isOnboarding !== undefined) {
      resolvedIsOnboarding = input.isOnboarding;
    }
  } else {
    resolvedIsOnboarding = false;
  }

  // 3. Atomically Update User & Settings inside Transaction
  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.dob !== undefined
          ? { dob: input.dob ? new Date(input.dob) : null }
          : {}),
        isOnboarding: resolvedIsOnboarding,
      },
      select: {
        id: true,
        name: true,
        email: true,
        dob: true,
        profileImage: true,
        isOnboarding: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    let updatedSettings = user.settings;
    const hasSettingsUpdate =
      input.currencySymbol !== undefined ||
      input.monthlyStartingAllowance !== undefined ||
      input.defaultPaymentMethod !== undefined ||
      input.selectedMonth !== undefined ||
      !user.settings;

    if (hasSettingsUpdate) {
      updatedSettings = await tx.userSettings.upsert({
        where: { userId },
        create: {
          userId,
          currencySymbol:
            input.currencySymbol !== undefined ? input.currencySymbol.trim() : "",
          monthlyStartingAllowance:
            input.monthlyStartingAllowance !== undefined
              ? input.monthlyStartingAllowance
              : 0,
          defaultPaymentMethod:
            input.defaultPaymentMethod !== undefined
              ? input.defaultPaymentMethod
              : null,
          selectedMonth:
            input.selectedMonth !== undefined
              ? input.selectedMonth
              : null,
        },
        update: {
          ...(input.currencySymbol !== undefined
            ? { currencySymbol: input.currencySymbol.trim() }
            : {}),
          ...(input.monthlyStartingAllowance !== undefined
            ? { monthlyStartingAllowance: input.monthlyStartingAllowance }
            : {}),
          ...(input.defaultPaymentMethod !== undefined
            ? { defaultPaymentMethod: input.defaultPaymentMethod }
            : {}),
          ...(input.selectedMonth !== undefined
            ? { selectedMonth: input.selectedMonth }
            : {}),
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
        },
      });
    }

    const [categories, paymentMethods] = await Promise.all([
      tx.userCategory.findMany({
        where: { userId, isDeleted: false },
        select: {
          id: true,
          name: true,
          type: true,
          icon: true,
          color: true,
          isSystem: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      tx.userPaymentMethod.findMany({
        where: { userId, isDeleted: false },
        select: {
          id: true,
          name: true,
          icon: true,
          isSystem: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      user: updatedUser,
      settings: updatedSettings,
      categories,
      paymentMethods,
    };
  });

  // Invalidate any active cache keys for settings
  try {
    await redis.del(`cache:settings:${userId}`);
  } catch {
    // Fail-open if redis is unavailable
  }

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "PROFILE",
    originClientId,
  });

  return {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
    dob: result.user.dob,
    profileImage: result.user.profileImage ?? null,
    isOnboarding: result.user.isOnboarding,
    joinedAt: result.user.createdAt,
    settings: {
      currencySymbol: result.settings?.currencySymbol || "",
      monthlyStartingAllowance: result.settings?.monthlyStartingAllowance ?? 0,
      defaultPaymentMethod: result.settings?.defaultPaymentMethod ?? null,
      selectedMonth: result.settings?.selectedMonth ?? null,
    },
    categories: result.categories,
    paymentMethods: result.paymentMethods,
  };
};

export const uploadAvatarService = async (
  userId: string,
  buffer: Buffer,
  originClientId?: string,
) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
    select: {
      id: true,
      profileImageId: true,
    },
  });

  if (!user) {
    throw new NotFoundError({
      code: "USER_NOT_FOUND",
      message: "User account not found.",
    });
  }

  const oldProfileImageId = user.profileImageId;

  // Stream buffer directly to Cloudinary
  const { secureUrl, publicId } = await uploadImageStream(buffer);

  try {
    // Persist new Cloudinary details in database
    await prisma.user.update({
      where: { id: userId },
      data: {
        profileImage: secureUrl,
        profileImageId: publicId,
      },
    });
  } catch (dbError) {
    // Rollback compensation: destroy newly uploaded Cloudinary image to prevent orphan asset
    await deleteCloudinaryImage(publicId);
    throw dbError;
  }

  // Once database has safely persisted the new image, prune old image from Cloudinary
  if (oldProfileImageId) {
    await deleteCloudinaryImage(oldProfileImageId);
  }

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "PROFILE",
    originClientId,
  });

  return getProfileService(userId);
};

export const removeAvatarService = async (
  userId: string,
  originClientId?: string,
) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
    select: {
      id: true,
      profileImageId: true,
    },
  });

  if (!user) {
    throw new NotFoundError({
      code: "USER_NOT_FOUND",
      message: "User account not found.",
    });
  }

  // Idempotent: If user has an existing Cloudinary asset, destroy it
  if (user.profileImageId) {
    await deleteCloudinaryImage(user.profileImageId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        profileImage: null,
        profileImageId: null,
      },
    });
  }

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "PROFILE",
    originClientId,
  });

  return getProfileService(userId);
};

