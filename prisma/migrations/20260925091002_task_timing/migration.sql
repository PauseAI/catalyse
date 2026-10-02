-- CreateEnum
CREATE TYPE "TaskTiming" AS ENUM ('flexible', 'fixed');

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "timing" "TaskTiming" NOT NULL DEFAULT 'flexible';
