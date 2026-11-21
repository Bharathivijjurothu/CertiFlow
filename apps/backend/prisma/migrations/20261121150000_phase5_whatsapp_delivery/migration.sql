-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "CertificateDelivery" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "maskedPhone" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "simulatedMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttemptLog" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "simulatedMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateDelivery_certificateId_channel_key" ON "CertificateDelivery"("certificateId", "channel");

-- CreateIndex
CREATE INDEX "CertificateDelivery_batchId_status_idx" ON "CertificateDelivery"("batchId", "status");

-- CreateIndex
CREATE INDEX "CertificateDelivery_certificateId_idx" ON "CertificateDelivery"("certificateId");

-- CreateIndex
CREATE INDEX "CertificateDelivery_studentId_idx" ON "CertificateDelivery"("studentId");

-- CreateIndex
CREATE INDEX "DeliveryAttemptLog_deliveryId_idx" ON "DeliveryAttemptLog"("deliveryId");

-- AddForeignKey
ALTER TABLE "CertificateDelivery" ADD CONSTRAINT "CertificateDelivery_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateDelivery" ADD CONSTRAINT "CertificateDelivery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateDelivery" ADD CONSTRAINT "CertificateDelivery_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttemptLog" ADD CONSTRAINT "DeliveryAttemptLog_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "CertificateDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
