-- Add advanced breadcrumb and table-of-contents storefront settings.
ALTER TABLE "ShopConfig"
ADD COLUMN "breadcrumbsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "breadcrumbsStyle" TEXT NOT NULL DEFAULT 'minimal',
ADD COLUMN "breadcrumbsShowHome" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "breadcrumbsHomeLabel" TEXT NOT NULL DEFAULT 'Home',
ADD COLUMN "breadcrumbsShowBlog" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "breadcrumbsCurrentClickable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "breadcrumbsSeparator" TEXT NOT NULL DEFAULT '/',
ADD COLUMN "tocEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tocTitle" TEXT NOT NULL DEFAULT 'Table of contents',
ADD COLUMN "tocLevels" TEXT NOT NULL DEFAULT 'h2,h3',
ADD COLUMN "tocStyle" TEXT NOT NULL DEFAULT 'boxed',
ADD COLUMN "tocNumbering" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tocSmoothScroll" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tocMobileCollapsed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tocStickyOffset" INTEGER NOT NULL DEFAULT 96,
ADD COLUMN "contentNavPrimaryColor" TEXT NOT NULL DEFAULT '#6366f1',
ADD COLUMN "contentNavCustomCss" TEXT;
