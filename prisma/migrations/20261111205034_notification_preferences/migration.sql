-- CreateEnum
CREATE TYPE "EmailDelivery" AS ENUM ('in_app', 'email', 'digest');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "digest_id" INTEGER,
ADD COLUMN     "in_digest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "notification_digests" (
    "id" SERIAL NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "sent_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" SERIAL NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "delivery" "EmailDelivery" NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_digests_volunteer_id_sent_on_key" ON "notification_digests"("volunteer_id", "sent_on");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_volunteer_id_type_key" ON "notification_preferences"("volunteer_id", "type");

-- CreateIndex
CREATE INDEX "idx_notifications_digest" ON "notifications"("in_digest", "digest_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "notification_digests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- BEGIN muted categories
-- A muted category stopped the emails of its types that went through notifyUser. Each of those
-- types that emails by default becomes In app only for whoever muted its category.
INSERT INTO "notification_preferences" ("volunteer_id", "type", "delivery")
SELECT v."id", t."type", 'in_app'::"EmailDelivery"
FROM "volunteers" v
JOIN (VALUES
  ('needs_action', 'new_interest', false),
  ('needs_action', 'team_join_request', false),
  ('needs_action', 'project_needs_discussion', false),
  ('needs_action', 'project_invite', false),
  ('needs_action', 'task_submitted', false),
  ('needs_action', 'contact_request', false),
  ('needs_action', 'new_volunteer_signup', false),
  ('needs_action', 'new_project_proposal', false),
  ('needs_action', 'project_lead_offer', false),
  ('needs_action', 'team_suggestion', false),
  ('needs_action', 'new_bug_report', true),
  ('update', 'project_approved', false),
  ('update', 'draft_submitted_by_admin', false),
  ('update', 'project_status_changed', false),
  ('update', 'interest_accepted', false),
  ('update', 'interest_declined', false),
  ('update', 'interest_removed', false),
  ('update', 'assigned_to_project', false),
  ('update', 'task_assigned', false),
  ('update', 'comment_reply', false),
  ('update', 'bug_report_resolved', false)
) AS t("category", "type", "technical_only")
  ON t."category" = ANY (v."email_muted_categories")
WHERE NOT t."technical_only" OR v."is_technical_admin" IS TRUE
ON CONFLICT ("volunteer_id", "type") DO NOTHING;
-- END muted categories

-- AlterTable
ALTER TABLE "volunteers" DROP COLUMN "email_muted_categories";
