-- AlterTable
ALTER TABLE "contact_messages" ADD COLUMN     "thread_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_contact_messages_thread" ON "contact_messages"("thread_id");

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

