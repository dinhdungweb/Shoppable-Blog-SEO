-- Add storefront product display customization settings.
ALTER TABLE "ShopConfig"
ADD COLUMN "imageAspectRatio" TEXT NOT NULL DEFAULT 'Square',
ADD COLUMN "imageFit" TEXT NOT NULL DEFAULT 'Cover',
ADD COLUMN "cardDensity" TEXT NOT NULL DEFAULT 'Comfortable',
ADD COLUMN "gridColumns" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "textAlignment" TEXT NOT NULL DEFAULT 'Left',
ADD COLUMN "buttonStyle" TEXT NOT NULL DEFAULT 'Solid',
ADD COLUMN "shadowStyle" TEXT NOT NULL DEFAULT 'Soft';
