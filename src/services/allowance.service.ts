import { prisma } from "@/lib/prisma.js";
import { getCache, setCache, deleteCache } from "@/lib/redis.js";
import { publishSyncEvent } from "@/lib/sync.js";
import type { Prisma } from "@/generated/prisma/client.js";
import type {
  GetAllowanceQueryInput,
  SetAllowanceInput,
} from "@/validators/allowance.validator.js";

export const getOrComputeAllowanceService = async (
  userId: string,
  input: GetAllowanceQueryInput,
) => {
  const { year, month } = input;

  return await prisma.$transaction(async (tx) => {
    // 1. Check if allowance exists for active month
    const existing = await tx.monthlyAllowance.findFirst({
      where: {
        userId,
        year,
        month,
        isDeleted: false,
      },
    });

    if (existing) {
      return existing;
    }

    // 2. Fetch user settings for default monthly starting allowance
    const userSettings = await tx.userSettings.findUnique({
      where: { userId },
    });

    const baselineAllowance = userSettings?.monthlyStartingAllowance ?? 2000;
    const initialAmount = baselineAllowance > 0 ? baselineAllowance : 2000;

    // 3. Auto-initialize this month's allowance with baseline starting allowance
    const newAllowance = await tx.monthlyAllowance.create({
      data: {
        userId,
        year,
        month,
        amount: initialAmount,
        isRollover: false,
      },
    });

    await Promise.all([
      deleteCache(`cache:allowance:summary:${userId}:${year}:${month}`),
      deleteCache(`cache:dashboard:${userId}:${year}:${month}`),
    ]);

    return newAllowance;
  });
};

export const setOrUpdateAllowanceService = async (
  userId: string,
  input: SetAllowanceInput,
  originClientId?: string,
) => {
  const { year, month, amount } = input;

  const allowance = await prisma.monthlyAllowance.upsert({
    where: {
      userId_year_month: {
        userId,
        year,
        month,
      },
    },
    update: {
      amount,
      isRollover: false,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    },
    create: {
      userId,
      year,
      month,
      amount,
      isRollover: false,
    },
  });

  // Actively invalidate caches for this month
  await Promise.all([
    deleteCache(`cache:allowance:summary:${userId}:${year}:${month}`),
    deleteCache(`cache:dashboard:${userId}:${year}:${month}`),
  ]);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "ALLOWANCE",
    originClientId,
    entityId: allowance.id,
  });

  return allowance;
};

export const getAllowanceSummaryService = async (
  userId: string,
  input: GetAllowanceQueryInput,
) => {
  const { year, month } = input;
  const cacheKey = `cache:allowance:summary:${userId}:${year}:${month}`;

  // Check Redis Cache
  const cached = await getCache<Record<string, unknown>>(cacheKey);
  if (cached) {
    return cached;
  }

  const allowance = await getOrComputeAllowanceService(userId, {
    year,
    month,
  });

  const startingAllowance = allowance.amount;

  const incomeSum = await prisma.income.aggregate({
    _sum: { amount: true },
    where: {
      userId,
      year,
      month,
      isDeleted: false,
    },
  });

  const expenseSum = await prisma.expense.aggregate({
    _sum: { amount: true },
    where: {
      userId,
      year,
      month,
      isDeleted: false,
    },
  });

  const totalIncome = incomeSum._sum.amount || 0;
  const totalExpense = expenseSum._sum.amount || 0;
  const remainingBalance = startingAllowance + totalIncome - totalExpense;
  const extraIncome =
    remainingBalance > startingAllowance
      ? remainingBalance - startingAllowance
      : 0;

  const result = {
    year,
    month,
    startingAllowance,
    totalIncome,
    totalExpense,
    remainingBalance,
    extraIncome,
  };

  // Populate Redis Cache (5 min TTL)
  await setCache(cacheKey, result, 300);

  return result;
};
