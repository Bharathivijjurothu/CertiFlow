-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'RETURNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewStage" AS ENUM ('DISTRICT', 'QUALITY', 'STATE');

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN "approvalRound" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "BatchReview" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerRole" "Role" NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "stage" "ReviewStage" NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchReview_batchId_round_idx" ON "BatchReview"("batchId", "round");

-- CreateIndex
CREATE INDEX "BatchReview_reviewerId_idx" ON "BatchReview"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchReview_batchId_round_stage_reviewerId_key" ON "BatchReview"("batchId", "round", "stage", "reviewerId");

-- AddForeignKey
ALTER TABLE "BatchReview" ADD CONSTRAINT "BatchReview_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchReview" ADD CONSTRAINT "BatchReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
