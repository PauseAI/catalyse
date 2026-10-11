-- CreateTable
CREATE TABLE "work_item_events" (
    "id" SERIAL NOT NULL,
    "work_item_id" INTEGER NOT NULL,
    "actor_id" INTEGER,
    "kind" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_work_item_events_thread" ON "work_item_events"("work_item_id", "created_at");

-- AddForeignKey
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

