-- CreateTable
CREATE TABLE "questionnaire_responses" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "form_id" TEXT NOT NULL,
    "response_id" TEXT NOT NULL,
    "responses" JSONB NOT NULL,
    "respondent_email" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processing_status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questionnaire_responses_project_id_idx" ON "questionnaire_responses"("project_id");

-- CreateIndex
CREATE INDEX "questionnaire_responses_processing_status_idx" ON "questionnaire_responses"("processing_status");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_form_id_response_id_key" ON "questionnaire_responses"("form_id", "response_id");

-- AddForeignKey
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
