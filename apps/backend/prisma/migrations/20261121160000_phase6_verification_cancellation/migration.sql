-- AlterEnum
ALTER TYPE "CertificateStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Certificate" ADD COLUMN "cancelledById" TEXT;

-- CreateTable
CREATE TABLE "CertificateAuditLog" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedById" TEXT,
    "reason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificateAuditLog_certificateId_idx" ON "CertificateAuditLog"("certificateId");
CREATE INDEX "CertificateAuditLog_performedById_idx" ON "CertificateAuditLog"("performedById");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateAuditLog" ADD CONSTRAINT "CertificateAuditLog_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateAuditLog" ADD CONSTRAINT "CertificateAuditLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
