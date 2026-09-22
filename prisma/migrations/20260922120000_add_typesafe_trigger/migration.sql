-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "intentMatching" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offerDescription" TEXT,
ADD COLUMN     "spamFilterEnabled" BOOLEAN NOT NULL DEFAULT false;
