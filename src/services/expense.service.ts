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
  CreateExpenseInput,
  UpdateExpenseInput,
  GetExpensesQueryInput,
} from "@/validators/expense.validator.js";
import {
  getUTCMonthRange,
  getMonthStrFromDate,
  parseQueryDate,
} from "@/utils/date.js";

export const createExpenseService = async (
  userId: string,
  input: CreateExpenseInput,
  originClientId?: string,
) => {
  const parsedDate = new Date(input.date);
  const year = parsedDate.getUTCFullYear();
  const month = parsedDate.getUTCMonth() + 1;
  const recordMonth = getMonthStrFromDate(parsedDate);

  const expense = await prisma.expense.create({
    data: {
      userId,
      year,
      month,
      amount: input.amount,
      category: input.category,
      date: parsedDate,
      paymentMethod: input.paymentMethod,
      description: input.description ?? null,
    },
  });

  // Invalidate monthly records and analytics caches
  await Promise.all([
    deleteCacheByPattern(`cache:expenses:${userId}:${recordMonth}:*`),
    deleteCacheByPattern(`cache:transactions:${userId}:${recordMonth}:*`),
    deleteCache(`cache:dashboard:${userId}:${year}:${month}`),
    deleteCache(`cache:allowance:summary:${userId}:${year}:${month}`),
  ]);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "EXPENSES",
    originClientId,
    entityId: expense.id,
  });

  return expense;
};

export const getExpensesService = async (
  userId: string,
  query: GetExpensesQueryInput,
) => {
  const {
    month,
    minAmount,
    maxAmount,
    startDate,
    endDate,
    category,
    categories,
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
  const cacheKey = `cache:expenses:${userId}:${month}:${JSON.stringify({
    category: category ?? null,
    categories: categories ?? null,
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

  const where: Prisma.ExpenseWhereInput = {
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


  if (categories) {
    const catList = categories
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (catList.length > 0) {
      where.category = { in: catList };
    }
  } else if (category) {
    where.category = category;
  }

  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }

  if (search) {
    where.OR = [
      { description: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { paymentMethod: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
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

export const updateExpenseService = async (
  userId: string,
  id: string,
  input: UpdateExpenseInput,
  originClientId?: string,
) => {
  const existing = await prisma.expense.findFirst({
    where: { id, userId, isDeleted: false },
  });

  if (!existing) {
    throw new NotFoundError({
      code: "EXPENSE_NOT_FOUND",
      message: "Expense record not found.",
    });
  }

  const data: Prisma.ExpenseUpdateInput = {};
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.category !== undefined) data.category = input.category;
  if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
  if (input.description !== undefined) data.description = input.description;
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

  const updated = await prisma.expense.update({
    where: { id },
    data,
  });

  // Invalidate previous month caches
  const oldMonthStr = getMonthStrFromDate(existing.date);
  const newMonthStr = parsedNewDate
    ? getMonthStrFromDate(parsedNewDate)
    : oldMonthStr;

  const invalidations = [
    deleteCacheByPattern(`cache:expenses:${userId}:${oldMonthStr}:*`),
    deleteCacheByPattern(`cache:transactions:${userId}:${oldMonthStr}:*`),
    deleteCache(`cache:dashboard:${userId}:${existing.year}:${existing.month}`),
    deleteCache(`cache:allowance:summary:${userId}:${existing.year}:${existing.month}`),
  ];

  // If date moved to a different month, invalidate new month as well
  if (newMonthStr !== oldMonthStr) {
    invalidations.push(
      deleteCacheByPattern(`cache:expenses:${userId}:${newMonthStr}:*`),
      deleteCacheByPattern(`cache:transactions:${userId}:${newMonthStr}:*`),
      deleteCache(`cache:dashboard:${userId}:${newYear}:${newMonth}`),
      deleteCache(`cache:allowance:summary:${userId}:${newYear}:${newMonth}`),
    );
  }

  await Promise.all(invalidations);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "EXPENSES",
    originClientId,
    entityId: id,
  });

  return updated;
};

export const deleteExpenseService = async (
  userId: string,
  id: string,
  originClientId?: string,
) => {
  const existing = await prisma.expense.findFirst({
    where: { id, userId, isDeleted: false },
  });

  if (!existing) {
    throw new NotFoundError({
      code: "EXPENSE_NOT_FOUND",
      message: "Expense record not found.",
    });
  }

  const deleted = await prisma.expense.update({
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
    deleteCacheByPattern(`cache:expenses:${userId}:${recordMonth}:*`),
    deleteCacheByPattern(`cache:transactions:${userId}:${recordMonth}:*`),
    deleteCache(`cache:dashboard:${userId}:${existing.year}:${existing.month}`),
    deleteCache(`cache:allowance:summary:${userId}:${existing.year}:${existing.month}`),
  ]);

  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "EXPENSES",
    originClientId,
    entityId: id,
  });

  return deleted;
};
