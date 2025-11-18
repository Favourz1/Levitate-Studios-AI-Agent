-- AlterTable
ALTER TABLE "documents" ADD COLUMN "last_sent_revision_id" INTEGER;

-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "intent_metadata" JSONB;

-- CreateTable
CREATE TABLE "global_configs" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_configs_key_key" ON "global_configs"("key");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_last_sent_revision_id_fkey" FOREIGN KEY ("last_sent_revision_id") REFERENCES "document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
