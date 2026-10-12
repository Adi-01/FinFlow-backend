import { prisma } from "@/lib/prisma.js";
import { ForbiddenError } from "@/errors/ForbiddenError.js";
import { ConflictError } from "@/errors/ConflictError.js";
import { NotFoundError } from "@/errors/NotFoundError.js";
import type { CategoryType, CreateCategoryInput } from "@/validators/category.validator.js";

// System defaults mapping with icons and vibrant colors for charts
export const SYSTEM_EXPENSE_CATEGORIES = [
  { name: "SHOPPING", label: "Shopping", icon: "ShoppingCart", color: "#EC4899" },
  { name: "FOOD", label: "Food", icon: "Utensils", color: "#F59E0B" },
  { name: "PHONE", label: "Phone", icon: "Smartphone", color: "#3B82F6" },
  { name: "ENTERTAINMENT", label: "Entertainment", icon: "Tv", color: "#8B5CF6" },
  { name: "EDUCATION", label: "Education", icon: "GraduationCap", color: "#6366F1" },
  { name: "BEAUTY", label: "Beauty", icon: "Sparkles", color: "#F43F5E" },
  { name: "TRANSPORTATION", label: "Transportation", icon: "Car", color: "#10B981" },
  { name: "CLOTHING", label: "Clothing", icon: "Shirt", color: "#A855F7" },
  { name: "VEHICLE", label: "Vehicle", icon: "Car", color: "#14B8A6" },
  { name: "DRINKS", label: "Drinks", icon: "Coffee", color: "#D97706" },
  { name: "CIGARRETES", label: "Cigarretes", icon: "Flame", color: "#EF4444" },
  { name: "ELECTRONICS", label: "Electronics", icon: "Laptop", color: "#06B6D4" },
  { name: "TRAVEL", label: "Travel", icon: "Plane", color: "#0EA5E9" },
  { name: "HEALTH", label: "Health", icon: "HeartPulse", color: "#E11D48" },
  { name: "PETS", label: "Pets", icon: "Dog", color: "#84CC16" },
  { name: "REPAIRS", label: "Repairs", icon: "Wrench", color: "#64748B" },
  { name: "HOUSING", label: "Housing", icon: "Home", color: "#3B82F6" },
  { name: "SNACKS", label: "Snacks", icon: "Cookie", color: "#F97316" },
  { name: "GROCERIES", label: "Groceries", icon: "ShoppingBag", color: "#22C55E" },
  { name: "PERSONAL", label: "Personal", icon: "User", color: "#6366F1" },
  { name: "OTHER", label: "Other", icon: "MoreHorizontal", color: "#94A3B8" },
];

export const SYSTEM_INCOME_SOURCES = [
  { name: "SALARY", label: "Salary", icon: "Briefcase", color: "#10B981" },
  { name: "INVESTMENT", label: "Investment", icon: "TrendingUp", color: "#3B82F6" },
  { name: "PART_TIME", label: "Part Time", icon: "Briefcase", color: "#6366F1" },
  { name: "FREELANCE", label: "Freelance", icon: "Laptop", color: "#8B5CF6" },
  { name: "BONUS", label: "Bonus", icon: "Gift", color: "#F59E0B" },
  { name: "GIFT", label: "Gift", icon: "Gift", color: "#EC4899" },
  { name: "BUSINESS", label: "Business", icon: "Building2", color: "#14B8A6" },
  { name: "OTHER", label: "Other", icon: "MoreHorizontal", color: "#94A3B8" },
];

export const MAX_CUSTOM_CATEGORIES_PER_TYPE = 10;

export const getCategoriesService = async (userId: string, type?: CategoryType) => {
  const customCategories = await prisma.userCategory.findMany({
    where: {
      userId,
      isDeleted: false,
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const incomeCustomCount = customCategories.filter((c) => c.type === "INCOME").length;
  const expenseCustomCount = customCategories.filter((c) => c.type === "EXPENSE").length;

  return {
    system: {
      income: SYSTEM_INCOME_SOURCES,
      expense: SYSTEM_EXPENSE_CATEGORIES,
    },
    custom: customCategories,
    quota: {
      incomeCustomCount,
      expenseCustomCount,
      maxLimit: MAX_CUSTOM_CATEGORIES_PER_TYPE,
    },
  };
};

export const createCategoryService = async (
  userId: string,
  input: CreateCategoryInput
) => {
  return await prisma.$transaction(async (tx) => {
    // Check count for quota limit
    const currentCount = await tx.userCategory.count({
      where: {
        userId,
        type: input.type,
        isDeleted: false,
        isSystem: false,
      },
    });

    if (currentCount >= MAX_CUSTOM_CATEGORIES_PER_TYPE) {
      throw new ForbiddenError({
        code: "QUOTA_EXCEEDED",
        message: `You have reached the limit of ${MAX_CUSTOM_CATEGORIES_PER_TYPE} custom ${input.type.toLowerCase()} categories. Delete an existing custom category to add a new one.`,
      });
    }

    // Check name uniqueness for user
    const existing = await tx.userCategory.findFirst({
      where: {
        userId,
        type: input.type,
        name: { equals: input.name, mode: "insensitive" },
        isDeleted: false,
      },
    });

    if (existing) {
      throw new ConflictError({
        code: "CATEGORY_EXISTS",
        message: `A category named "${input.name}" already exists.`,
      });
    }

    return await tx.userCategory.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        icon: input.icon,
        color: input.color,
        isSystem: false,
      },
    });
  });
};

export const deleteCategoryService = async (userId: string, id: string) => {
  const category = await prisma.userCategory.findFirst({
    where: {
      id,
      userId,
      isDeleted: false,
    },
  });

  if (!category) {
    throw new NotFoundError({
      code: "CATEGORY_NOT_FOUND",
      message: "Custom category not found.",
    });
  }

  if (category.isSystem) {
    throw new ForbiddenError({
      code: "SYSTEM_CATEGORY_PROTECTED",
      message: "System categories cannot be deleted.",
    });
  }

  return await prisma.userCategory.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: userId,
    },
  });
};
