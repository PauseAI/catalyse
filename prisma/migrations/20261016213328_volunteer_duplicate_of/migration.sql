-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "duplicate_of_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_volunteers_duplicate_of" ON "volunteers"("duplicate_of_id");

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
