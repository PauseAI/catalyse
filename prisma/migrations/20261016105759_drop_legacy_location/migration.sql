-- Project and volunteer locations are held by chapter, reach and local group id now; the
-- country, local group name and remote-eligibility columns they replace go.
-- DropIndex
DROP INDEX "idx_volunteers_local_group";

-- DropIndex
DROP INDEX "idx_work_items_country";

-- DropIndex
DROP INDEX "idx_work_items_local_group";

-- AlterTable
ALTER TABLE "local_groups" ALTER COLUMN "national_chapter_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "volunteers" DROP COLUMN "local_group",
DROP COLUMN "notify_remote_projects";

-- AlterTable
ALTER TABLE "work_items" DROP COLUMN "country",
DROP COLUMN "local_group",
DROP COLUMN "remote_eligibility";

-- DropEnum
DROP TYPE "RemoteEligibility";

