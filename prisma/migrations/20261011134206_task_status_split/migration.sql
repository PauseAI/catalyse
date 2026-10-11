-- A task's status is the work's own progress; who holds it is the assignee alone.
ALTER TYPE "TaskStatus" RENAME VALUE 'open' TO 'not_started';

-- `work_items.status` is text shared by every work item type, so the enum rename alone does not
-- reach the rows. Quick Tasks keep 'open' (QuickTaskStatus).
UPDATE "work_items" SET "status" = 'not_started' WHERE "type" = 'TASK' AND "status" = 'open';

ALTER TABLE "work_items" ADD COLUMN "claimed_at" TIMESTAMP(3);

-- An assigned task was claimed when it was started: claiming used to start it.
UPDATE "work_items"
SET "claimed_at" = COALESCE("started_at", "updated_at")
WHERE "type" = 'TASK'
  AND "assignee_id" IS NOT NULL;
