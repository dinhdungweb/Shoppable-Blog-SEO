ALTER TABLE "ResourceSEO" ADD COLUMN "issueCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "ResourceSEO"
SET "issueCount" = CASE
  WHEN "issues" IS NOT NULL AND "issues" ~ '^\s*\[' THEN jsonb_array_length("issues"::jsonb)
  ELSE 0
END;

CREATE INDEX "ResourceSEO_shop_resourceType_issueCount_idx" ON "ResourceSEO"("shop", "resourceType", "issueCount");
