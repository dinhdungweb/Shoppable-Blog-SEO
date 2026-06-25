-- Add carousel navigation display toggles.
ALTER TABLE "ShopConfig"
ADD COLUMN "showCarouselArrows" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showCarouselDots" BOOLEAN NOT NULL DEFAULT true;
