-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "show_timeline" BOOLEAN NOT NULL DEFAULT false;

-- A project already has a timeline worth showing when any of its tasks has a date, which is
-- what gives a task a bar on the chart.
UPDATE "work_items" AS p
SET "show_timeline" = true
WHERE p."type" = 'PROJECT'
  AND EXISTS (
    SELECT 1 FROM "work_items" AS t
    WHERE t."parent_id" = p."id"
      AND t."type" = 'TASK'
      AND (t."start_date" IS NOT NULL OR t."duration_days" IS NOT NULL OR t."deadline" IS NOT NULL)
  );
