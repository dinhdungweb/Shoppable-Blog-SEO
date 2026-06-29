-- Add optional automatic table-of-contents placement settings.
ALTER TABLE "ShopConfig"
ADD COLUMN "tocAutoInsertEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tocAutoInsertPosition" TEXT NOT NULL DEFAULT 'after-title';
