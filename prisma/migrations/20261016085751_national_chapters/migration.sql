-- CreateEnum
CREATE TYPE "ProjectReach" AS ENUM ('COUNTRY_WIDE', 'LOCAL', 'REMOTE');

-- CreateEnum
CREATE TYPE "ChapterRoleKind" AS ENUM ('LEAD', 'DEPUTY');

-- CreateEnum
CREATE TYPE "ChapterTransferStatus" AS ENUM ('pending', 'approved', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "ChapterAuditAction" AS ENUM ('CHAPTER_CREATED', 'CHAPTER_UPDATED', 'LEAD_APPOINTED', 'LEAD_REMOVED', 'DEPUTY_APPOINTED', 'DEPUTY_REMOVED', 'VOLUNTEER_REASSIGNED', 'TRANSFER_APPROVED', 'TRANSFER_DECLINED', 'PROJECT_CHAPTER_CHANGED', 'TEAM_CHAPTER_CHANGED', 'ROLE_INVITE_SENT', 'ROLE_INVITE_ACCEPTED');

-- AlterTable
ALTER TABLE "admin_invites" ADD COLUMN     "national_chapter_id" INTEGER,
ADD COLUMN     "role" "ChapterRoleKind";

-- AlterTable
ALTER TABLE "local_group_suggestions" ADD COLUMN     "national_chapter_id" INTEGER;

-- AlterTable
ALTER TABLE "local_groups" ADD COLUMN     "national_chapter_id" INTEGER;

-- AlterTable
ALTER TABLE "team_suggestions" ADD COLUMN     "national_chapter_id" INTEGER;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "national_chapter_id" INTEGER;

-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "local_group_id" INTEGER,
ADD COLUMN     "national_chapter_id" INTEGER;

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "local_group_id" INTEGER,
ADD COLUMN     "national_chapter_id" INTEGER,
ADD COLUMN     "reach" "ProjectReach" NOT NULL DEFAULT 'COUNTRY_WIDE';

-- CreateTable
CREATE TABLE "national_chapters" (
    "id" SERIAL NOT NULL,
    "country" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lead_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "national_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_deputies" (
    "id" SERIAL NOT NULL,
    "national_chapter_id" INTEGER NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "appointed_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_deputies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_transfer_requests" (
    "id" SERIAL NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "from_chapter_id" INTEGER,
    "to_chapter_id" INTEGER,
    "to_country" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ChapterTransferStatus" NOT NULL DEFAULT 'pending',
    "decided_by_id" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_audit_events" (
    "id" SERIAL NOT NULL,
    "action" "ChapterAuditAction" NOT NULL,
    "actor_id" INTEGER,
    "national_chapter_id" INTEGER,
    "target_volunteer_id" INTEGER,
    "work_item_id" INTEGER,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "national_chapters_country_key" ON "national_chapters"("country");

-- CreateIndex
CREATE UNIQUE INDEX "national_chapters_lead_id_key" ON "national_chapters"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_deputies_volunteer_id_key" ON "chapter_deputies"("volunteer_id");

-- CreateIndex
CREATE INDEX "idx_chapter_deputies_chapter" ON "chapter_deputies"("national_chapter_id");

-- CreateIndex
CREATE INDEX "idx_chapter_transfers_to_status" ON "chapter_transfer_requests"("to_chapter_id", "status");

-- CreateIndex
CREATE INDEX "idx_chapter_transfers_volunteer_status" ON "chapter_transfer_requests"("volunteer_id", "status");

-- CreateIndex
CREATE INDEX "idx_chapter_audit_chapter_created" ON "chapter_audit_events"("national_chapter_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_local_groups_chapter_name" ON "local_groups"("national_chapter_id", "name");

-- CreateIndex
CREATE INDEX "idx_teams_chapter" ON "teams"("national_chapter_id");

-- CreateIndex
CREATE INDEX "idx_volunteers_chapter" ON "volunteers"("national_chapter_id");

-- CreateIndex
CREATE INDEX "idx_work_items_chapter" ON "work_items"("national_chapter_id");

-- CreateIndex
CREATE INDEX "idx_work_items_local_group_id" ON "work_items"("local_group_id");

-- AddForeignKey
ALTER TABLE "national_chapters" ADD CONSTRAINT "national_chapters_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_deputies" ADD CONSTRAINT "chapter_deputies_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_deputies" ADD CONSTRAINT "chapter_deputies_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_deputies" ADD CONSTRAINT "chapter_deputies_appointed_by_id_fkey" FOREIGN KEY ("appointed_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_transfer_requests" ADD CONSTRAINT "chapter_transfer_requests_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_transfer_requests" ADD CONSTRAINT "chapter_transfer_requests_from_chapter_id_fkey" FOREIGN KEY ("from_chapter_id") REFERENCES "national_chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_transfer_requests" ADD CONSTRAINT "chapter_transfer_requests_to_chapter_id_fkey" FOREIGN KEY ("to_chapter_id") REFERENCES "national_chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_transfer_requests" ADD CONSTRAINT "chapter_transfer_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_audit_events" ADD CONSTRAINT "chapter_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_audit_events" ADD CONSTRAINT "chapter_audit_events_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_audit_events" ADD CONSTRAINT "chapter_audit_events_target_volunteer_id_fkey" FOREIGN KEY ("target_volunteer_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_audit_events" ADD CONSTRAINT "chapter_audit_events_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_local_group_id_fkey" FOREIGN KEY ("local_group_id") REFERENCES "local_groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "local_groups" ADD CONSTRAINT "local_groups_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "local_group_suggestions" ADD CONSTRAINT "local_group_suggestions_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "team_suggestions" ADD CONSTRAINT "team_suggestions_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_national_chapter_id_fkey" FOREIGN KEY ("national_chapter_id") REFERENCES "national_chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_local_group_id_fkey" FOREIGN KEY ("local_group_id") REFERENCES "local_groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill ------------------------------------------------------------------------------------

-- The countries a chapter can be made for, as stored and as shown (lib/countries.ts).
CREATE TEMP TABLE chapter_countries (value TEXT PRIMARY KEY, label TEXT NOT NULL);
INSERT INTO chapter_countries (value, label) VALUES
  ('Australia', 'Australia'), ('Belgium', 'Belgium'), ('Canada', 'Canada'),
  ('Czech Republic', 'Czech Republic'), ('France', 'France'), ('Germany', 'Germany'),
  ('Ghana', 'Ghana'), ('Italy', 'Italy'), ('Kenya', 'Kenya'), ('Netherlands', 'Netherlands'),
  ('Nigeria', 'Nigeria'), ('Poland', 'Poland'), ('Romania', 'Romania'), ('Serbia', 'Serbia'),
  ('Spain', 'Spain'), ('Sweden', 'Sweden'), ('Switzerland', 'Switzerland'),
  ('UK', 'United Kingdom'), ('US', 'United States');

-- Signup took free text, so fold spellings and case onto the stored values.
CREATE TEMP TABLE country_aliases (alias TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO country_aliases (alias, value)
  SELECT lower(value), value FROM chapter_countries
  UNION SELECT lower(label), value FROM chapter_countries
  ON CONFLICT DO NOTHING;
INSERT INTO country_aliases (alias, value) VALUES
  ('gb', 'UK'), ('great britain', 'UK'), ('england', 'UK'), ('scotland', 'UK'),
  ('wales', 'UK'), ('northern ireland', 'UK'), ('united states of america', 'US'),
  ('usa', 'US'), ('u.s.', 'US'), ('u.k.', 'UK'), ('czechia', 'Czech Republic'),
  ('the netherlands', 'Netherlands'), ('holland', 'Netherlands')
  ON CONFLICT DO NOTHING;

UPDATE "volunteers" v SET "country" = a.value
  FROM country_aliases a WHERE lower(btrim(v."country")) = a.alias AND v."country" <> a.value;
UPDATE "work_items" w SET "country" = a.value
  FROM country_aliases a WHERE lower(btrim(w."country")) = a.alias AND w."country" <> a.value;
UPDATE "local_groups" g SET "country" = a.value
  FROM country_aliases a WHERE lower(btrim(g."country")) = a.alias AND g."country" <> a.value;
UPDATE "local_group_suggestions" s SET "country" = a.value
  FROM country_aliases a WHERE lower(btrim(s."country")) = a.alias AND s."country" <> a.value;

-- A chapter for every listed country something already belongs to.
INSERT INTO "national_chapters" ("country", "name")
  SELECT c.value, c.label FROM chapter_countries c
  WHERE EXISTS (SELECT 1 FROM "volunteers" v WHERE v."country" = c.value AND v."deleted_at" IS NULL)
     OR EXISTS (SELECT 1 FROM "work_items" w WHERE w."country" = c.value)
     OR EXISTS (SELECT 1 FROM "local_groups" g WHERE g."country" = c.value)
  ORDER BY c.label;

UPDATE "local_groups" g SET "national_chapter_id" = nc."id"
  FROM "national_chapters" nc WHERE nc."country" = g."country";
UPDATE "local_group_suggestions" s SET "national_chapter_id" = nc."id"
  FROM "national_chapters" nc WHERE nc."country" = s."country";

-- Volunteers: a country with no chapter (Remote, Other, blank) leaves them in the pool. A local
-- group name that matches no group in their chapter is kept as their free-text location.
UPDATE "volunteers" v SET "national_chapter_id" = nc."id"
  FROM "national_chapters" nc WHERE nc."country" = v."country";
UPDATE "volunteers" v SET "local_group_id" = g."id"
  FROM "local_groups" g
  WHERE g."national_chapter_id" = v."national_chapter_id" AND g."name" = v."local_group";
UPDATE "volunteers" SET "location" = "local_group"
  WHERE "local_group_id" IS NULL AND "local_group" IS NOT NULL AND btrim("local_group") <> ''
    AND ("location" IS NULL OR btrim("location") = '');

-- Projects: remote of either kind is remote within the chapter; a matched group makes it local.
UPDATE "work_items" w SET "national_chapter_id" = nc."id"
  FROM "national_chapters" nc WHERE w."type" = 'PROJECT' AND nc."country" = w."country";
UPDATE "work_items" w SET "local_group_id" = g."id"
  FROM "local_groups" g
  WHERE w."type" = 'PROJECT' AND g."national_chapter_id" = w."national_chapter_id" AND g."name" = w."local_group";
UPDATE "work_items" SET "reach" = CASE
    WHEN "remote_eligibility" IN ('COUNTRY', 'GLOBAL') THEN 'REMOTE'::"ProjectReach"
    WHEN "local_group_id" IS NOT NULL THEN 'LOCAL'::"ProjectReach"
    ELSE 'COUNTRY_WIDE'::"ProjectReach"
  END
  WHERE "type" = 'PROJECT';
UPDATE "work_items" SET "local_group_id" = NULL WHERE "reach" <> 'LOCAL' AND "local_group_id" IS NOT NULL;

-- Quick tasks follow the project they were made for, else the person who made them.
UPDATE "work_items" q SET "national_chapter_id" = COALESCE(p."national_chapter_id", c."national_chapter_id")
  FROM "work_items" q2
  LEFT JOIN "work_items" p ON p."id" = q2."context_project_id"
  LEFT JOIN "volunteers" c ON c."id" = q2."creator_id"
  WHERE q."id" = q2."id" AND q."type" = 'QUICK_TASK';

-- Teams go to the chapter most of their leaders are in, else most of their members; a tie
-- leaves the team in the pool.
WITH ranked AS (
  SELECT m."team_id", v."national_chapter_id" AS chapter_id,
         count(*) FILTER (WHERE m."role" = 'leader') AS leaders, count(*) AS members
  FROM "team_memberships" m JOIN "volunteers" v ON v."id" = m."volunteer_id"
  WHERE v."national_chapter_id" IS NOT NULL AND v."deleted_at" IS NULL
  GROUP BY 1, 2
), ordered AS (
  SELECT *, rank() OVER (PARTITION BY "team_id" ORDER BY leaders DESC, members DESC) AS r,
         count(*) OVER (PARTITION BY "team_id", leaders, members) AS tied
  FROM ranked
)
UPDATE "teams" t SET "national_chapter_id" = o.chapter_id
  FROM ordered o WHERE o."team_id" = t."id" AND o.r = 1 AND o.tied = 1;

UPDATE "team_suggestions" s SET "national_chapter_id" = v."national_chapter_id"
  FROM "volunteers" v WHERE v."id" = s."suggested_by_id";

DROP TABLE country_aliases;
DROP TABLE chapter_countries;
