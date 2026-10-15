-- A task's bar ends on its deadline, so a task stores no length of its own; only a milestone
-- keeps its zero. A fixed task's window was a commitment, so its last day becomes its deadline.
UPDATE "work_items"
SET "deadline" = "start_date" + ("duration_days" - 1) * INTERVAL '1 day'
WHERE "type" = 'TASK'
  AND "timing" = 'fixed'
  AND "start_date" IS NOT NULL
  AND "duration_days" > 0
  AND "deadline" IS NULL;

UPDATE "work_items"
SET "duration_days" = NULL
WHERE "type" = 'TASK'
  AND "duration_days" <> 0;
