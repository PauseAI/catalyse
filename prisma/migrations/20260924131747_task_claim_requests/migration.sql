-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "requested_by_id" INTEGER;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

