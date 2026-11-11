-- CreateTable
CREATE TABLE "call_dismissals" (
    "call_id" INTEGER NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_dismissals_pkey" PRIMARY KEY ("call_id","volunteer_id")
);

-- CreateIndex
CREATE INDEX "idx_call_dismissals_volunteer" ON "call_dismissals"("volunteer_id");

-- AddForeignKey
ALTER TABLE "call_dismissals" ADD CONSTRAINT "call_dismissals_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_dismissals" ADD CONSTRAINT "call_dismissals_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

