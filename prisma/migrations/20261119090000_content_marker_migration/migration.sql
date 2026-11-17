-- When legacy text placeholders ([[SBS_...]]) in existing articles were converted to hidden elements.
ALTER TABLE "ShopConfig" ADD COLUMN "markersMigratedAt" TIMESTAMP(3);
