-- CreateTable
CREATE TABLE "call_skills" (
    "call_id" INTEGER NOT NULL,
    "skill_id" INTEGER NOT NULL,

    CONSTRAINT "call_skills_pkey" PRIMARY KEY ("call_id","skill_id")
);

-- CreateIndex
CREATE INDEX "idx_call_skills_skill" ON "call_skills"("skill_id");

-- AddForeignKey
ALTER TABLE "call_skills" ADD CONSTRAINT "call_skills_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_skills" ADD CONSTRAINT "call_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Carry each call's one skill over
INSERT INTO "call_skills" ("call_id", "skill_id")
SELECT "id", "skill_id" FROM "calls" WHERE "skill_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_skill_id_fkey";

-- AlterTable
ALTER TABLE "calls" DROP COLUMN "skill_id";
