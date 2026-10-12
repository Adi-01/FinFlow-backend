-- AlterTable User: Add missing profile, dob, onboarding columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dob" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileImage" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileImageId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isOnboarding" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable UserSettings: Add allowance, default method, selected month
ALTER TABLE "UserSettings" ALTER COLUMN "currencySymbol" SET DEFAULT '';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "monthlyStartingAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "defaultPaymentMethod" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "selectedMonth" TEXT;

-- AlterTable Income: Convert enums to TEXT for flexible custom sources & payment methods
ALTER TABLE "Income" ALTER COLUMN "source" TYPE TEXT USING "source"::TEXT;
ALTER TABLE "Income" ALTER COLUMN "paymentMethod" TYPE TEXT USING "paymentMethod"::TEXT;

-- AlterTable Expense: Convert enums to TEXT for custom categories & payment methods
ALTER TABLE "Expense" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "Expense" ALTER COLUMN "paymentMethod" TYPE TEXT USING "paymentMethod"::TEXT;

-- CreateEnum CategoryType
DO $$ BEGIN
    CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable UserCategory
CREATE TABLE IF NOT EXISTS "UserCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Briefcase',
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "UserCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex UserCategory
CREATE INDEX IF NOT EXISTS "UserCategory_userId_type_isDeleted_idx" ON "UserCategory"("userId", "type", "isDeleted");

-- AddForeignKey UserCategory
DO $$ BEGIN
    ALTER TABLE "UserCategory" ADD CONSTRAINT "UserCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable UserPaymentMethod
CREATE TABLE IF NOT EXISTS "UserPaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'CreditCard',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "UserPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex UserPaymentMethod
CREATE INDEX IF NOT EXISTS "UserPaymentMethod_userId_isDeleted_idx" ON "UserPaymentMethod"("userId", "isDeleted");

-- AddForeignKey UserPaymentMethod
DO $$ BEGIN
    ALTER TABLE "UserPaymentMethod" ADD CONSTRAINT "UserPaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable ReflectReport
CREATE TABLE IF NOT EXISTS "ReflectReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "ReflectReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex ReflectReport
CREATE INDEX IF NOT EXISTS "ReflectReport_userId_isDeleted_idx" ON "ReflectReport"("userId", "isDeleted");
CREATE UNIQUE INDEX IF NOT EXISTS "ReflectReport_userId_year_month_key" ON "ReflectReport"("userId", "year", "month");

-- AddForeignKey ReflectReport
DO $$ BEGIN
    ALTER TABLE "ReflectReport" ADD CONSTRAINT "ReflectReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

