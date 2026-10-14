import { prisma } from "@/lib/prisma.js";
import {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
} from "@/lib/redis.js";
import { publishSyncEvent } from "@/lib/sync.js";
import { NotFoundError } from "@/errors/NotFoundError.js";
import type { Prisma } from "@/generated/prisma/client.js";
import type {
  CreateIncomeInput,
  UpdateIncomeInput,
  GetIncomesQueryInput,
} from "@/validators/income.validator.js";
import {
  getUTCMonthRange,
  getMonthStrFromDate,
  parseQueryDate,
} from "@/utils/date.js";

export const createIncomeService = async (
  userId: string,
  input: CreateIncomeInput,
  originClientId?: string,
) => {
  const parsedDate = new Date(input.date);
  const year = parsedDate.getUTCFullYear();
  const month = parsedDate.getUTCMonth() + 1;
  const recordMonth = getMonthStrFromDate(parsedDate);

  const income = await prisma.income.create({
    data: {
      userId,
      year,
      month,
      amount: input.amount,
      source: input.source,
      date: parsedDate,
      paymentMethod: input.paymentMethod,
      notes: input.notes ?? null,
    },
  });

  // Invalidate monthly records and analytics caches
  await Promise.all([
    deleteCacheByPattern(`cache:incomes:${userId}:${recordMonth}:*`),
    deleteCacheByPattern(`cache:transactions:${userId}:${recordMonth}:*`),
    deleteCache(`cache:dashboard:${userId}:${year}:${month}`),
    deleteCache(`cache:allowance:summary:${userId}:${year}:${month}`),
  ]);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "INCOME",
    originClientId,
    entityId: income.id,
  });

  return income;
};

export const getIncomesService = async (
  userId: string,
  query: GetIncomesQueryInput,
) => {
  const {
    month,
    minAmount,
    maxAmount,
    startDate,
    endDate,
    source,
    paymentMethod,
    search,
    sortBy = "date",
    sortOrder = "desc",
    page = 1,
    limit = 20,
  } = query;

  // 1. Calculate UTC month boundaries
  const { startOfMonth, endOfMonth } = getUTCMonthRange(month);

  // 2. Check Redis Cache
  const cacheKey = `cache:incomes:${userId}:${month}:${JSON.stringify({
    source: source ?? null,
    paymentMethod: paymentMethod ?? null,
    minAmount: minAmount ?? null,
    maxAmount: maxAmount ?? null,
    search: search ?? null,
    sortBy,
    sortOrder,
    page,
    limit,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  })}`;

  const cached = await getCache<{
    items: unknown[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }>(cacheKey);

  if (cached) {
    return cached;
  }

  // 3. Build Prisma query with month-bounded date range
  const parsedStartDate = startDate ? parseQueryDate(startDate, false) : null;
  const parsedEndDate = endDate ? parseQueryDate(endDate, true) : null;

  const computedStart = parsedStartDate
    ? new Date(Math.max(parsedStartDate.getTime(), startOfMonth.getTime()))
    : startOfMonth;
  const computedEnd = parsedEndDate
    ? new Date(Math.min(parsedEndDate.getTime(), endOfMonth.getTime()))
    : endOfMonth;

  const where: Prisma.IncomeWhereInput = {
    userId,
    isDeleted: false,
    date: {
      gte: computedStart,
      lte: computedEnd,
    },
  };

  if (minAmount !== undefined || maxAmount !== undefined) {
    where.amount = {
      ...(minAmount !== undefined && { gte: minAmount }),
      ...(maxAmount !== undefined && { lte: maxAmount }),
    };
  }

  if (source) {
    where.source = source;
  }

  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }


  if (search) {
    where.OR = [
      { notes: { contains: search, mode: "insensitive" } },
      { source: { contains: search, mode: "insensitive" } },
      { paymentMethod: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.income.count({ where }),
    prisma.income.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const result = {
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };

  // 4. Store in Redis with 5-minute TTL
  await setCache(cacheKey, result, 300);

  return result;
};

export const updateIncomeService = async (
  userId: string,
  id: string,
  input: UpdateIncomeInput,
  originClientId?: string,
) => {
  const existing = await prisma.income.findFirst({
    where: { id, userId, isDeleted: false },
  });

  if (!existing) {
    throw new NotFoundError({
      code: "INCOME_NOT_FOUND",
      message: "Income record not found.",
    });
  }

  const data: Prisma.IncomeUpdateInput = {};
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.source !== undefined) data.source = input.source;
  if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
  if (input.notes !== undefined) data.notes = input.notes;
  let newYear = existing.year;
  let newMonth = existing.month;
  let parsedNewDate: Date | undefined;

  if (input.date !== undefined) {
    parsedNewDate = new Date(input.date);
    newYear = parsedNewDate.getUTCFullYear();
    newMonth = parsedNewDate.getUTCMonth() + 1;
    data.date = parsedNewDate;
    data.year = newYear;
    data.month = newMonth;
  }

  const updated = await prisma.income.update({
    where: { id },
    data,
  });

  // Invalidate previous month caches
  const oldMonthStr = getMonthStrFromDate(existing.date);
  const newMonthStr = parsedNewDate
    ? getMonthStrFromDate(parsedNewDate)
    : oldMonthStr;

  const invalidations = [
    deleteCacheByPattern(`cache:incomes:${userId}:${oldMonthStr}:*`),
    deleteCacheByPattern(`cache:transactions:${userId}:${oldMonthStr}:*`),
    deleteCache(`cache:dashboard:${userId}:${existing.year}:${existing.month}`),
    deleteCache(`cache:allowance:summary:${userId}:${existing.year}:${existing.month}`),
  ];

  // If date moved to a different month, invalidate new month as well
  if (newMonthStr !== oldMonthStr) {
    invalidations.push(
      deleteCacheByPattern(`cache:incomes:${userId}:${newMonthStr}:*`),
      deleteCacheByPattern(`cache:transactions:${userId}:${newMonthStr}:*`),
      deleteCache(`cache:dashboard:${userId}:${newYear}:${newMonth}`),
      deleteCache(`cache:allowance:summary:${userId}:${newYear}:${newMonth}`),
    );
  }

  await Promise.all(invalidations);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "INCOME",
    originClientId,
    entityId: id,
  });

  return updated;
};

export const deleteIncomeService = async (
  userId: string,
  id: string,
  originClientId?: string,
) => {
  const existing = await prisma.income.findFirst({
    where: { id, userId, isDeleted: false },
  });

  if (!existing) {
    throw new NotFoundError({
      code: "INCOME_NOT_FOUND",
      message: "Income record not found.",
    });
  }

  const deleted = await prisma.income.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: userId,
    },
  });

  const recordMonth = getMonthStrFromDate(existing.date);

  // Invalidate monthly records and analytics caches
  await Promise.all([
    deleteCacheByPattern(`cache:incomes:${userId}:${recordMonth}:*`),
    deleteCacheByPattern(`cache:transactions:${userId}:${recordMonth}:*`),
    deleteCache(`cache:dashboard:${userId}:${existing.year}:${existing.month}`),
    deleteCache(`cache:allowance:summary:${userId}:${existing.year}:${existing.month}`),
  ]);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "INCOME",
    originClientId,
    entityId: id,
  });

  return deleted;
};
