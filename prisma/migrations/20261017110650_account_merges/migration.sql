-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "merged_into_id" INTEGER;

-- CreateTable
CREATE TABLE "account_merges" (
    "id" SERIAL NOT NULL,
    "kept_id" INTEGER NOT NULL,
    "merged_id" INTEGER NOT NULL,
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "conflicts_resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_merge_requests" (
    "id" SERIAL NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "other_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_merge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_account_merges_kept" ON "account_merges"("kept_id");

-- CreateIndex
CREATE INDEX "idx_account_merges_merged" ON "account_merges"("merged_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_merge_requests_token_key" ON "account_merge_requests"("token");

-- CreateIndex
CREATE INDEX "idx_account_merge_requests_requester" ON "account_merge_requests"("requester_id");

-- CreateIndex
CREATE INDEX "idx_account_merge_requests_other" ON "account_merge_requests"("other_id");

-- AddForeignKey
ALTER TABLE "account_merges" ADD CONSTRAINT "account_merges_kept_id_fkey" FOREIGN KEY ("kept_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_merges" ADD CONSTRAINT "account_merges_merged_id_fkey" FOREIGN KEY ("merged_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_merge_requests" ADD CONSTRAINT "account_merge_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_merge_requests" ADD CONSTRAINT "account_merge_requests_other_id_fkey" FOREIGN KEY ("other_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

