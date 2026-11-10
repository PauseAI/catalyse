-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChapterAuditAction" ADD VALUE 'COORDINATOR_APPOINTED';
ALTER TYPE "ChapterAuditAction" ADD VALUE 'COORDINATOR_REMOVED';

-- CreateTable
CREATE TABLE "coordinators" (
    "id" SERIAL NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "remit" TEXT,
    "appointed_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coordinators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" SERIAL NOT NULL,
    "sender_id" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "chapter_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "skill_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_responses" (
    "id" SERIAL NOT NULL,
    "call_id" INTEGER NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coordinators_volunteer_id_key" ON "coordinators"("volunteer_id");

-- CreateIndex
CREATE INDEX "idx_calls_created" ON "calls"("created_at");

-- CreateIndex
CREATE INDEX "idx_call_responses_volunteer" ON "call_responses"("volunteer_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_responses_call_id_volunteer_id_key" ON "call_responses"("call_id", "volunteer_id");

-- AddForeignKey
ALTER TABLE "coordinators" ADD CONSTRAINT "coordinators_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coordinators" ADD CONSTRAINT "coordinators_appointed_by_id_fkey" FOREIGN KEY ("appointed_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_responses" ADD CONSTRAINT "call_responses_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_responses" ADD CONSTRAINT "call_responses_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

