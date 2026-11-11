-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('daily', 'every_3_days', 'weekly');

-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "digest_frequency" "DigestFrequency" NOT NULL DEFAULT 'daily',
ADD COLUMN     "digest_hour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "time_zone" TEXT;

