-- AlterEnum
ALTER TYPE "InterestOrigin" ADD VALUE 'invited';

-- AlterEnum
ALTER TYPE "InterestStatus" ADD VALUE 'invited';
ALTER TYPE "InterestStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "work_item_interests" ADD COLUMN     "invited_by_id" INTEGER;

-- AddForeignKey
ALTER TABLE "work_item_interests" ADD CONSTRAINT "work_item_interests_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

