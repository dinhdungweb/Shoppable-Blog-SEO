-- Add desktop carousel visible item count.
ALTER TABLE "ShopConfig"
ADD COLUMN "carouselItemsVisible" INTEGER NOT NULL DEFAULT 4;
