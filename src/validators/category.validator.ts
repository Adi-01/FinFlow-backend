import { z } from "zod";

export const CategoryTypeEnum = z.enum(["INCOME", "EXPENSE"]);
export type CategoryType = z.infer<typeof CategoryTypeEnum>;

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(50, "Name must be under 50 characters."),
  type: CategoryTypeEnum,
  icon: z.string().trim().min(1, "Icon is required.").default("Briefcase"),
  color: z.string().trim().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color hex code.").default("#6366F1"),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
