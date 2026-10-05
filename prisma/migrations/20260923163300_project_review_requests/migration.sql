-- CreateTable
CREATE TABLE "project_review_requests" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "requested_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "project_review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_review_requests_project" ON "project_review_requests"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_review_requests" ADD CONSTRAINT "project_review_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_review_requests" ADD CONSTRAINT "project_review_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill: a project already waiting on changes gets one open request, so its proposer
-- sees the banner and can resubmit. The message itself lives in the project's discussion.
INSERT INTO "project_review_requests" ("project_id", "message", "requested_by_id", "created_at")
SELECT "id",
       'A team lead asked for changes before this goes live. See the discussion below.',
       "reviewed_by_id",
       COALESCE("reviewed_at", "updated_at", CURRENT_TIMESTAMP)
FROM "work_items"
WHERE "type" = 'PROJECT' AND "status" = 'needs_discussion';
