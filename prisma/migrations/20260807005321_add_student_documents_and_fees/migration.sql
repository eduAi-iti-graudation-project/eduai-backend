-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CERTIFICATE', 'REPORT_CARD', 'TRANSCRIPT', 'IMMUNIZATION', 'TRANSFER', 'ENROLLMENT_FORM', 'ID', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('TUITION', 'REGISTRATION', 'EXAM', 'MATERIALS', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PAID', 'PARTIAL', 'POSTPONED', 'UNPAID');

-- CreateTable
CREATE TABLE "student_documents" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "academicYear" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_payments" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYear" TEXT NOT NULL,
    "feeType" "FeeType" NOT NULL DEFAULT 'TUITION',
    "amount" DECIMAL(10,2) NOT NULL,
    "amountPaid" DECIMAL(10,2),
    "status" "FeeStatus" NOT NULL DEFAULT 'UNPAID',
    "body" TEXT,
    "paidAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_documents_studentId_idx" ON "student_documents"("studentId");

-- CreateIndex
CREATE INDEX "fee_payments_studentId_academicYear_idx" ON "fee_payments"("studentId", "academicYear");

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
