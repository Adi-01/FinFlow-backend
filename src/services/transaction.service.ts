import { prisma } from "@/lib/prisma.js";
import { getCache, setCache } from "@/lib/redis.js";
import type { Prisma } from "@/generated/prisma/client.js";
import type { GetTransactionsQueryInput } from "@/validators/transaction.validator.js";
import { getUTCMonthRange, parseQueryDate } from "@/utils/date.js";

export interface UnifiedTransaction {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  categoryOrSource: string;
  date: Date;
  paymentMethod: string;
  descriptionOrNotes: string | null;
  createdAt: Date;
}

export const getTransactionsService = async (
  userId: string,
  query: GetTransactionsQueryInput,
) => {
  const {
    month,
    type = "ALL",
    category,
    paymentMethod,
    minAmount,
    maxAmount,
    startDate,
    endDate,
    search,
    sortBy = "date",
    sortOrder = "desc",
    page = 1,
    limit = 20,
  } = query;

  // 1. Calculate UTC month boundaries
  const { startOfMonth, endOfMonth } = getUTCMonthRange(month);

  // 2. Check Redis Cache
  const cacheKey = `cache:transactions:${userId}:${month}:${JSON.stringify({
    type,
    category: category ?? null,
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
    items: UnifiedTransaction[];
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

  // 3. Build Prisma queries with month-bounded date range
  const parsedStartDate = startDate ? parseQueryDate(startDate, false) : null;
  const parsedEndDate = endDate ? parseQueryDate(endDate, true) : null;

  const computedStart = parsedStartDate
    ? new Date(Math.max(parsedStartDate.getTime(), startOfMonth.getTime()))
    : startOfMonth;
  const computedEnd = parsedEndDate
    ? new Date(Math.min(parsedEndDate.getTime(), endOfMonth.getTime()))
    : endOfMonth;

  const incomeWhere: Prisma.IncomeWhereInput = {
    userId,
    isDeleted: false,
    date: {
      gte: computedStart,
      lte: computedEnd,
    },
  };
  const expenseWhere: Prisma.ExpenseWhereInput = {
    userId,
    isDeleted: false,
    date: {
      gte: computedStart,
      lte: computedEnd,
    },
  };

  if (minAmount !== undefined || maxAmount !== undefined) {
    const amountFilter: Prisma.FloatFilter = {
      ...(minAmount !== undefined && { gte: minAmount }),
      ...(maxAmount !== undefined && { lte: maxAmount }),
    };
    incomeWhere.amount = amountFilter;
    expenseWhere.amount = amountFilter;
  }


  if (category) {
    incomeWhere.source = category;
    expenseWhere.category = category;
  }

  if (paymentMethod) {
    incomeWhere.paymentMethod = paymentMethod;
    expenseWhere.paymentMethod = paymentMethod;
  }

  if (search) {
    incomeWhere.OR = [
      { notes: { contains: search, mode: "insensitive" } },
      { source: { contains: search, mode: "insensitive" } },
      { paymentMethod: { contains: search, mode: "insensitive" } },
    ];

    expenseWhere.OR = [
      { description: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { paymentMethod: { contains: search, mode: "insensitive" } },
    ];
  }

  let result: {
    items: UnifiedTransaction[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };

  // Branch 1: Only query income when type === "INCOME"
  if (type === "INCOME") {
    const [total, rawIncomes] = await Promise.all([
      prisma.income.count({ where: incomeWhere }),
      prisma.income.findMany({
        where: incomeWhere,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items: UnifiedTransaction[] = rawIncomes.map((inc) => ({
      id: inc.id,
      type: "INCOME" as const,
      amount: inc.amount,
      categoryOrSource: inc.source,
      date: inc.date,
      paymentMethod: inc.paymentMethod,
      descriptionOrNotes: inc.notes,
      createdAt: inc.createdAt,
    }));

    result = {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  } else if (type === "EXPENSE") {
    // Branch 2: Only query expense when type === "EXPENSE"
    const [total, rawExpenses] = await Promise.all([
      prisma.expense.count({ where: expenseWhere }),
      prisma.expense.findMany({
        where: expenseWhere,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items: UnifiedTransaction[] = rawExpenses.map((exp) => ({
      id: exp.id,
      type: "EXPENSE" as const,
      amount: exp.amount,
      categoryOrSource: exp.category,
      date: exp.date,
      paymentMethod: exp.paymentMethod,
      descriptionOrNotes: exp.description,
      createdAt: exp.createdAt,
    }));

    result = {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  } else {
    // Branch 3: Combined "ALL" query
    const maxFetch = page * limit;
    const [incomeTotal, expenseTotal, rawIncomes, rawExpenses] =
      await Promise.all([
        prisma.income.count({ where: incomeWhere }),
        prisma.expense.count({ where: expenseWhere }),
        prisma.income.findMany({
          where: incomeWhere,
          orderBy: { [sortBy]: sortOrder },
          take: maxFetch,
        }),
        prisma.expense.findMany({
          where: expenseWhere,
          orderBy: { [sortBy]: sortOrder },
          take: maxFetch,
        }),
      ]);

    const total = incomeTotal + expenseTotal;

    const incomes: UnifiedTransaction[] = rawIncomes.map((inc) => ({
      id: inc.id,
      type: "INCOME" as const,
      amount: inc.amount,
      categoryOrSource: inc.source,
      date: inc.date,
      paymentMethod: inc.paymentMethod,
      descriptionOrNotes: inc.notes,
      createdAt: inc.createdAt,
    }));

    const expenses: UnifiedTransaction[] = rawExpenses.map((exp) => ({
      id: exp.id,
      type: "EXPENSE" as const,
      amount: exp.amount,
      categoryOrSource: exp.category,
      date: exp.date,
      paymentMethod: exp.paymentMethod,
      descriptionOrNotes: exp.description,
      createdAt: exp.createdAt,
    }));

    const combined = [...incomes, ...expenses];

    combined.sort((a, b) => {
      const valA = sortBy === "amount" ? a.amount : new Date(a.date).getTime();
      const valB = sortBy === "amount" ? b.amount : new Date(b.date).getTime();
      if (sortOrder === "desc") {
        return valB > valA ? 1 : valB < valA ? -1 : 0;
      }
      return valA > valB ? 1 : valA < valB ? -1 : 0;
    });

    const paginatedItems = combined.slice((page - 1) * limit, page * limit);

    result = {
      items: paginatedItems,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 4. Store in Redis with 5-minute TTL
  await setCache(cacheKey, result, 300);

  return result;
};

const sanitizeCsvCell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Neutralize CSV formula injection: =, +, -, @, tab, or carriage return at the start
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
};

export const exportTransactionsCSVService = async (
  userId: string,
  query: GetTransactionsQueryInput,
) => {
  const result = await getTransactionsService(userId, {
    ...query,
    page: 1,
    limit: 10000,
  });

  const headers = [
    "ID",
    "Type",
    "Amount",
    "Category/Source",
    "Date",
    "Payment Method",
    "Description/Notes",
  ];
  const rows = result.items.map((tx) => [
    sanitizeCsvCell(tx.id),
    sanitizeCsvCell(tx.type),
    tx.amount.toFixed(2),
    sanitizeCsvCell(tx.categoryOrSource),
    sanitizeCsvCell(new Date(tx.date).toISOString().split("T")[0]),
    sanitizeCsvCell(tx.paymentMethod),
    sanitizeCsvCell(tx.descriptionOrNotes || ""),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
};
