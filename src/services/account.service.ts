import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma.js";
import { NotFoundError } from "@/errors/NotFoundError.js";
import { BadRequestError } from "@/errors/BadRequestError.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import { deleteCacheByPattern, redis } from "@/lib/redis.js";
import {
  getUserSessions,
  getSession,
  revokeSession,
  revokeAllSessions,
  isSessionRevoked,
} from "@/lib/session.js";
import { publishSyncEvent } from "@/lib/sync.js";
import type {
  ChangePasswordInput,
  DeleteAccountInput,
} from "@/validators/profile.validator.js";

export const changePasswordService = async (
  userId: string,
  input: ChangePasswordInput,
  currentSessionId?: string,
) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
  });

  if (!user) {
    throw new NotFoundError({
      code: "USER_NOT_FOUND",
      message: "User account not found.",
    });
  }

  const isCurrentPasswordCorrect = await bcrypt.compare(
    input.currentPassword,
    user.password,
  );
  if (!isCurrentPasswordCorrect) {
    throw new UnauthorizedError({
      code: "INVALID_CURRENT_PASSWORD",
      message: "Current password does not match.",
    });
  }

  const isIdentical = await bcrypt.compare(input.newPassword, user.password);
  if (isIdentical) {
    throw new BadRequestError({
      code: "PASSWORD_IDENTICAL",
      message: "New password cannot be identical to your current password.",
    });
  }

  const hashedPassword = await bcrypt.hash(input.newPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  // Revoke other active sessions for security while retaining current session
  await revokeAllSessions(userId, currentSessionId);

  return {
    message: "Password changed successfully.",
  };
};

export const getSessionsService = async (
  userId: string,
  currentSessionId?: string,
) => {
  const allSessions = await getUserSessions(userId);

  const sessions = allSessions.map((s) => ({
    sessionId: s.sessionId,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastActive: s.lastActive,
    isCurrent: Boolean(currentSessionId && s.sessionId === currentSessionId),
  }));

  return {
    sessions,
  };
};

export const revokeSessionService = async (
  userId: string,
  targetSessionId: string,
  currentSessionId?: string,
  originClientId?: string,
) => {
  const existing = await getSession(userId, targetSessionId);
  if (!existing) {
    throw new NotFoundError({
      code: "SESSION_NOT_FOUND",
      message: "Session not found or already expired.",
    });
  }

  await revokeSession(userId, targetSessionId);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "PROFILE",
    originClientId,
  });

  return {
    revokedSessionId: targetSessionId,
    wasCurrent: Boolean(currentSessionId && targetSessionId === currentSessionId),
  };
};

export const revokeOtherSessionsService = async (
  userId: string,
  currentSessionId?: string,
  originClientId?: string,
) => {
  // If the current session was already revoked concurrently by another tab/session,
  // silently bail out so we don't accidentally execute a cross-revocation
  if (currentSessionId && (await isSessionRevoked(userId, currentSessionId))) {
    return {
      revokedCount: 0,
    };
  }

  // Atomic mutex to prevent concurrent execution if Tab A and Tab B click simultaneously
  const lockKey = `lock:revoke-sessions:${userId}`;
  const acquired = await redis.set(lockKey, currentSessionId || "1", "EX", 10, "NX");
  if (!acquired) {
    // Another concurrent session revocation is in progress; silently no-op
    return {
      revokedCount: 0,
    };
  }

  try {
    // Double check session validity after acquiring lock
    if (currentSessionId && (await isSessionRevoked(userId, currentSessionId))) {
      return {
        revokedCount: 0,
      };
    }

    const beforeSessions = await getUserSessions(userId);
    const targetSessions = beforeSessions.filter(
      (s) => !currentSessionId || s.sessionId !== currentSessionId,
    );

    if (targetSessions.length === 0) {
      return {
        revokedCount: 0,
      };
    }

    await revokeAllSessions(userId, currentSessionId);

    await publishSyncEvent(userId, {
      type: "INVALIDATE",
      scope: "PROFILE",
      originClientId,
    });

    return {
      revokedCount: targetSessions.length,
    };
  } finally {
    await redis.del(lockKey);
  }
};

export const exportUserDataService = async (
  userId: string,
  format: "json" | "csv" = "json",
) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      email: true,
      dob: true,
      isOnboarding: true,
      createdAt: true,
      updatedAt: true,
      settings: {
        select: {
          currencySymbol: true,
          monthlyStartingAllowance: true,
          defaultPaymentMethod: true,
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

  const [allowances, incomes, expenses, categories, paymentMethods] =
    await Promise.all([
      prisma.monthlyAllowance.findMany({
        where: { userId, isDeleted: false },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      }),
      prisma.income.findMany({
        where: { userId, isDeleted: false },
        orderBy: { date: "desc" },
      }),
      prisma.expense.findMany({
        where: { userId, isDeleted: false },
        orderBy: { date: "desc" },
      }),
      prisma.userCategory.findMany({
        where: { userId, isDeleted: false },
      }),
      prisma.userPaymentMethod.findMany({
        where: { userId, isDeleted: false },
      }),
    ]);

  if (format === "csv") {
    const csvRows: string[] = [];

    // Header
    csvRows.push(
      [
        "Type",
        "ID",
        "Date",
        "Amount",
        "Category_or_Source",
        "Payment_Method",
        "Description_or_Notes",
        "Created_At",
      ].join(","),
    );

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    for (const inc of incomes) {
      csvRows.push(
        [
          escapeCsv("INCOME"),
          escapeCsv(inc.id),
          escapeCsv(inc.date.toISOString()),
          escapeCsv(inc.amount),
          escapeCsv(inc.source),
          escapeCsv(inc.paymentMethod),
          escapeCsv(inc.notes || ""),
          escapeCsv(inc.createdAt.toISOString()),
        ].join(","),
      );
    }

    for (const exp of expenses) {
      csvRows.push(
        [
          escapeCsv("EXPENSE"),
          escapeCsv(exp.id),
          escapeCsv(exp.date.toISOString()),
          escapeCsv(exp.amount),
          escapeCsv(exp.category),
          escapeCsv(exp.paymentMethod),
          escapeCsv(exp.description || ""),
          escapeCsv(exp.createdAt.toISOString()),
        ].join(","),
      );
    }

    return {
      contentType: "text/csv; charset=utf-8",
      filename: `finflow-export-${user.id}-${Date.now()}.csv`,
      data: csvRows.join("\r\n"),
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    filename: `finflow-export-${user.id}-${Date.now()}.json`,
    data: {
      exportedAt: new Date().toISOString(),
      user,
      allowances,
      incomes,
      expenses,
      categories,
      paymentMethods,
    },
  };
};

export const deleteAccountService = async (
  userId: string,
  input: DeleteAccountInput,
) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isDeleted: false,
    },
  });

  if (!user) {
    throw new NotFoundError({
      code: "USER_NOT_FOUND",
      message: "User account not found.",
    });
  }

  const isPasswordValid = await bcrypt.compare(input.password, user.password);
  if (!isPasswordValid) {
    throw new UnauthorizedError({
      code: "INVALID_PASSWORD",
      message: "Invalid password for account deletion.",
    });
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const tombstoneEmail = `deleted_${Date.now()}_${userId}@deleted.local`;
    await tx.user.update({
      where: { id: userId },
      data: {
        email: tombstoneEmail,
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.userSettings.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.monthlyAllowance.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.income.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.expense.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.userCategory.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.userPaymentMethod.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });

    await tx.reflectReport.updateMany({
      where: { userId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
      },
    });
  });

  // Terminate all sessions and evict user caches
  await revokeAllSessions(userId);
  await deleteCacheByPattern(`*:${userId}*`);

  return {
    message: "Your account and associated data have been permanently deleted.",
  };
};

