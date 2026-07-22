ALTER TABLE "StorefrontPerformanceScan"
  ALTER COLUMN "seoScore" SET DEFAULT 0,
  ALTER COLUMN "mobileScore" SET DEFAULT 0,
  ALTER COLUMN "desktopScore" SET DEFAULT 0,
  ALTER COLUMN "report" DROP NOT NULL,
  ALTER COLUMN "scannedAt" DROP NOT NULL,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN "error" TEXT;
