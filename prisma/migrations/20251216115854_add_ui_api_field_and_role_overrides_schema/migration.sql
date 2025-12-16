-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "acting_role" TEXT;

-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "is_manually_logged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN     "password" TEXT;

-- CreateTable
CREATE TABLE "role_permission_override" (
    "id" SERIAL NOT NULL,
    "role" TEXT NOT NULL,
    "overrides" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permission_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_override_role_key" ON "role_permission_override"("role");
