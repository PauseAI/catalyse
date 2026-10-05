-- AlterTable
ALTER TABLE "bug_report_comments" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "work_item_comments" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "parent_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_work_item_comments_parent" ON "work_item_comments"("parent_id");

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "work_item_comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

