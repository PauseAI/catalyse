-- AlterEnum
ALTER TYPE "ChapterAuditAction" ADD VALUE 'PROFILE_PICTURE_REMOVED';

-- CreateTable
CREATE TABLE "profile_pictures" (
    "volunteer_id" INTEGER NOT NULL,
    "public_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_pictures_pkey" PRIMARY KEY ("volunteer_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_pictures_public_id_key" ON "profile_pictures"("public_id");

-- AddForeignKey
ALTER TABLE "profile_pictures" ADD CONSTRAINT "profile_pictures_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

