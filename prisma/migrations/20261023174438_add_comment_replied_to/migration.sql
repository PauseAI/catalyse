-- AlterTable
ALTER TABLE "work_item_comments" ADD COLUMN     "replied_to_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_work_item_comments_replied_to" ON "work_item_comments"("replied_to_id");

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_replied_to_id_fkey" FOREIGN KEY ("replied_to_id") REFERENCES "work_item_comments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
