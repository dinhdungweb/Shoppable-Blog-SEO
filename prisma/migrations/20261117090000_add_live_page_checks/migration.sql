-- Timestamp of the last storefront (live HTML) check, used to rotate checks across scans.
ALTER TABLE "ArticleSEO" ADD COLUMN "liveCheckedAt" TIMESTAMP(3);
ALTER TABLE "ResourceSEO" ADD COLUMN "liveCheckedAt" TIMESTAMP(3);
