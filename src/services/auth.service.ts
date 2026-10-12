import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma.js";
import { signSessionToken } from "@/lib/jwt.js";
import { ConflictError } from "@/errors/ConflictError.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import type { RegisterInput, LoginInput } from "@/validators/auth.validator.js";

import { saveSession } from "@/lib/session.js";

export const registerUser = async (input: RegisterInput) => {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existingUser = await prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      isDeleted: false,
    },
  });

  if (existingUser) {
    throw new ConflictError({
      code: "EMAIL_IN_USE",
      message: "An account with this email address already exists.",
    });
  }

  const hashedPassword = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      isOnboarding: true,
      settings: {
        create: {
          currencySymbol: "",
        },
      },
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
        },
      },
    },
  });

  const sessionId = crypto.randomUUID();
  const sessionToken = await signSessionToken({ id: user.id, sessionId });
  await saveSession(user.id, sessionId, {});

  return {
    user,
    sessionToken,
  };
};

export const loginUser = async (input: LoginInput) => {
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      isDeleted: false,
    },
    include: {
      settings: {
        select: {
          currencySymbol: true,
        },
      },
    },
  });

  if (!user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  }

  const isPasswordValid = await bcrypt.compare(input.password, user.password);
  if (!isPasswordValid) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  }

  const sessionId = crypto.randomUUID();
  const sessionToken = await signSessionToken({ id: user.id, sessionId });
  await saveSession(user.id, sessionId, {});

  const {
    password,
    isDeleted,
    deletedAt,
    deletedBy,
    profileImageId,
    ...userWithoutPassword
  } = user;

  return {
    user: userWithoutPassword,
    sessionToken,
  };
};


