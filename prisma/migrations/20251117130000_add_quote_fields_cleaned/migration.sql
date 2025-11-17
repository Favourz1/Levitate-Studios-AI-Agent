/*
  Warnings:

  - You are about to drop the column `is_variant` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `variant_index` on the `documents` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "documents" DROP COLUMN "is_variant",
DROP COLUMN "variant_index",
ADD COLUMN     "erp_quote_id" TEXT,
ADD COLUMN     "erp_variant_ids" JSONB,
-- ADD COLUMN     "last_sent_revision_id" INTEGER,
ADD COLUMN     "selected_quote_id" TEXT;

-- AlterTable
-- ALTER TABLE "emails" ADD COLUMN     "intent_metadata" JSONB;

-- CreateTable
-- CREATE TABLE "global_configs" (
--     "id" SERIAL NOT NULL,
--     "key" TEXT NOT NULL,
--     "value" JSONB NOT NULL,
--     "description" TEXT,
--     "updated_at" TIMESTAMP(3) NOT NULL,
--     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

--     CONSTRAINT "global_configs_pkey" PRIMARY KEY ("id")
-- );

-- -- CreateIndex
-- CREATE UNIQUE INDEX "global_configs_key_key" ON "global_configs"("key");

-- AddForeignKey
-- ALTER TABLE "documents" ADD CONSTRAINT "documents_last_sent_revision_id_fkey" FOREIGN KEY ("last_sent_revision_id") REFERENCES "document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
