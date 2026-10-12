import { prisma } from "@/lib/prisma.js";
import { NotFoundError } from "@/errors/NotFoundError.js";

export const getCurrentUser = async (userId: string) => {
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
      profileImage: true,
      isOnboarding: true,
      createdAt: true,
      updatedAt: true,
      settings: {
        select: {
          currencySymbol: true,
          monthlyStartingAllowance: true,
          defaultPaymentMethod: true,
          selectedMonth: true,
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

  return user;
};
