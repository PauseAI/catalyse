-- CreateEnum
CREATE TYPE "ContactRequestStatus" AS ENUM ('pending', 'accepted', 'declined');

-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "last_active_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" SERIAL NOT NULL,
    "from_volunteer_id" INTEGER NOT NULL,
    "to_volunteer_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ContactRequestStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_contact_requests_from" ON "contact_requests"("from_volunteer_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_contact_requests_to" ON "contact_requests"("to_volunteer_id", "status");

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_from_volunteer_id_fkey" FOREIGN KEY ("from_volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_to_volunteer_id_fkey" FOREIGN KEY ("to_volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

