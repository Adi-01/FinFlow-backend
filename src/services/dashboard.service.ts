import { prisma } from "@/lib/prisma.js";
import { getCache, setCache } from "@/lib/redis.js";
import { getOrComputeAllowanceService } from "@/services/allowance.service.js";
import type { GetDashboardQueryInput } from "@/validators/dashboard.validator.js";

export const getDashboardMetricsService = async (
  userId: string,
  input: GetDashboardQueryInput,
) => {
  const { year, month } = input;
  const cacheKey = `cache:dashboard:${userId}:${year}:${month}`;

  // 1. Cache-Aside Check
  const cached = await getCache<Record<string, unknown>>(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Allowance & Rollover Status
  const allowanceData = await getOrComputeAllowanceService(userId, {
    year,
    month,
  });
  const startingAllowance = allowanceData.allowance
    ? allowanceData.allowance.amount
    : 0;

  // 3. Fetch Incomes for month
  const incomes = await prisma.income.findMany({
    where: {
      userId,
      year,
      month,
      isDeleted: false,
    },
    orderBy: { date: "asc" },
  });

  // 4. Fetch Expenses for month
  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      year,
      month,
      isDeleted: false,
    },
    orderBy: { date: "asc" },
  });

  // 5. Summaries
  const totalIncome = incomes.reduce((acc, curr) => acc + curr.amount, 0);
  const totalExpense = expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const remainingBalance = startingAllowance + totalIncome - totalExpense;
  const extraIncome =
    remainingBalance > startingAllowance
      ? remainingBalance - startingAllowance
      : 0;
  const totalTransactions = incomes.length + expenses.length;

  // 6. Daily Income vs Expense breakdown
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyMap: Record<
    number,
    { day: number; income: number; expense: number }
  > = {};

  for (let d = 1; d <= daysInMonth; d++) {
    dailyMap[d] = { day: d, income: 0, expense: 0 };
  }

  incomes.forEach((inc) => {
    const day = new Date(inc.date).getUTCDate();
    const entry = dailyMap[day];
    if (entry) entry.income += inc.amount;
  });

  expenses.forEach((exp) => {
    const day = new Date(exp.date).getUTCDate();
    const entry = dailyMap[day];
    if (entry) entry.expense += exp.amount;
  });

  const dailyAnalytics = Object.values(dailyMap);

  // Fetch custom category color map for user
  const userCategories = await prisma.userCategory.findMany({
    where: { userId, isDeleted: false },
    select: { name: true, type: true, color: true },
  });
  const customColorMap: Record<string, string> = {};
  userCategories.forEach((c: { name: string; type: string; color: string }) => {
    customColorMap[`${c.type}:${c.name.toUpperCase()}`] = c.color;
  });

  // 7. Expense Category Pie Data
  const expenseCatMap: Record<string, number> = {};
  expenses.forEach((exp) => {
    expenseCatMap[exp.category] =
      (expenseCatMap[exp.category] || 0) + exp.amount;
  });

  const expenseCategoryBreakdown = Object.entries(expenseCatMap).map(
    ([category, amount]) => ({
      category,
      amount,
      percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
      color: customColorMap[`EXPENSE:${category.toUpperCase()}`] || undefined,
    }),
  );

  // 8. Income Category (Source) Pie Data
  const incomeSourceMap: Record<string, number> = {};
  incomes.forEach((inc) => {
    incomeSourceMap[inc.source] =
      (incomeSourceMap[inc.source] || 0) + inc.amount;
  });

  const incomeSourceBreakdown = Object.entries(incomeSourceMap).map(
    ([source, amount]) => ({
      source,
      amount,
      percentage: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
      color: customColorMap[`INCOME:${source.toUpperCase()}`] || undefined,
    }),
  );

  const result = {
    year,
    month,
    allowance: allowanceData.allowance,
    needsAllowancePrompt: allowanceData.needsPrompt,
    summary: {
      startingAllowance,
      totalIncome,
      totalExpense,
      remainingBalance,
      extraIncome,
      totalTransactions,
    },
    dailyAnalytics,
    expenseCategoryBreakdown,
    incomeSourceBreakdown,
  };

  // 9. Populate Redis cache (5 minutes TTL)
  await setCache(cacheKey, result, 300);

  return result;
};
