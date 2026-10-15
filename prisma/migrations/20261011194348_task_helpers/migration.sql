-- Nullable, and null (no helpers sought) is right for every existing task: no backfill.
ALTER TABLE "work_items" ADD COLUMN "helpers_wanted" INTEGER;
