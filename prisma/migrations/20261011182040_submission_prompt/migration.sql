-- Every existing row is filled with `true`, so tasks made before the link field became
-- per-task keep offering it; the default then drops to `false` for every task made from now on.
ALTER TABLE "work_items" ADD COLUMN "submission_asks_link" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "submission_prompt" TEXT;

ALTER TABLE "work_items" ALTER COLUMN "submission_asks_link" SET DEFAULT false;
