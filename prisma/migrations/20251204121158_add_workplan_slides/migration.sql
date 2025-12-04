-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "service_types" JSONB;

-- CreateTable
CREATE TABLE "workplan_slides" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "slideNumber" INTEGER NOT NULL,
    "slideType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "research_data" JSONB,
    "content_copy" TEXT,
    "data_points" JSONB,
    "design_directives" JSONB,
    "layout_type" TEXT,
    "visual_elements" JSONB,
    "research_status" TEXT NOT NULL DEFAULT 'PENDING',
    "content_status" TEXT NOT NULL DEFAULT 'PENDING',
    "design_status" TEXT NOT NULL DEFAULT 'PENDING',
    "quality_score" DECIMAL(3,2),
    "metadata_info" JSONB,
    "requires_big_idea" BOOLEAN NOT NULL DEFAULT false,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workplan_slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_workplan_slides_document_id" ON "workplan_slides"("document_id");

-- CreateIndex
CREATE INDEX "idx_workplan_slides_type" ON "workplan_slides"("slideType");

-- CreateIndex
CREATE INDEX "idx_workplan_slides_research_status" ON "workplan_slides"("research_status");

-- CreateIndex
CREATE UNIQUE INDEX "workplan_slides_document_id_slideNumber_key" ON "workplan_slides"("document_id", "slideNumber");

-- AddForeignKey
ALTER TABLE "workplan_slides" ADD CONSTRAINT "workplan_slides_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
