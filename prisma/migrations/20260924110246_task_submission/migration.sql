-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'under_review';

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "auto_accept_tasks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "changes_requested_note" TEXT,
ADD COLUMN     "submission_note" TEXT,
ADD COLUMN     "submission_url" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3);
