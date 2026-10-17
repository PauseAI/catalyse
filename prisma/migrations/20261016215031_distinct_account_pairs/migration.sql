-- CreateTable
CREATE TABLE "distinct_account_pairs" (
    "volunteer_a_id" INTEGER NOT NULL,
    "volunteer_b_id" INTEGER NOT NULL,
    "dismissed_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distinct_account_pairs_pkey" PRIMARY KEY ("volunteer_a_id","volunteer_b_id")
);

-- CreateIndex
CREATE INDEX "idx_distinct_account_pairs_b" ON "distinct_account_pairs"("volunteer_b_id");

-- AddForeignKey
ALTER TABLE "distinct_account_pairs" ADD CONSTRAINT "distinct_account_pairs_volunteer_a_id_fkey" FOREIGN KEY ("volunteer_a_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distinct_account_pairs" ADD CONSTRAINT "distinct_account_pairs_volunteer_b_id_fkey" FOREIGN KEY ("volunteer_b_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distinct_account_pairs" ADD CONSTRAINT "distinct_account_pairs_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

