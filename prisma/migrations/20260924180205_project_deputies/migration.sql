-- CreateTable
CREATE TABLE "project_deputies" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "volunteer_id" INTEGER NOT NULL,
    "appointed_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_deputies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_deputies_volunteer" ON "project_deputies"("volunteer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_project_deputies_project_volunteer" ON "project_deputies"("project_id", "volunteer_id");

-- AddForeignKey
ALTER TABLE "project_deputies" ADD CONSTRAINT "project_deputies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_deputies" ADD CONSTRAINT "project_deputies_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_deputies" ADD CONSTRAINT "project_deputies_appointed_by_id_fkey" FOREIGN KEY ("appointed_by_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

