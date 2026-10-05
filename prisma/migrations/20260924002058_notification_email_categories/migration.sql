-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "email_muted_categories" TEXT[] DEFAULT ARRAY[]::TEXT[];
