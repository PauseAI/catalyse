-- CreateEnum
CREATE TYPE "DailySummaryPreference" AS ENUM ('email_and_in_app', 'in_app_only', 'off');

-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "daily_summary" "DailySummaryPreference" NOT NULL DEFAULT 'email_and_in_app';

-- CreateTable
CREATE TABLE "finish_by_reminders" (
    "id" SERIAL NOT NULL,
    "work_item_id" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "finish_by" TIMESTAMP(3) NOT NULL,
    "recipient_id" INTEGER NOT NULL,
    "sent_on" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finish_by_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_finish_by_reminders_recipient" ON "finish_by_reminders"("recipient_id", "sent_on");

-- CreateIndex
CREATE UNIQUE INDEX "uq_finish_by_reminders" ON "finish_by_reminders"("work_item_id", "stage", "finish_by", "recipient_id", "sent_on");

-- AddForeignKey
ALTER TABLE "finish_by_reminders" ADD CONSTRAINT "finish_by_reminders_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "finish_by_reminders" ADD CONSTRAINT "finish_by_reminders_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

