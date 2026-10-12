import { z } from "zod";

export const createPaymentMethodSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(50, "Name must be under 50 characters."),
  icon: z.string().trim().min(1, "Icon is required.").default("CreditCard"),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial();

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
