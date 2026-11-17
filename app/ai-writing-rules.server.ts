import prisma from "./db.server";
import { normalizeAiWritingRules, type AiWritingRules } from "./ai-writing-rules";

/**
 * Loads Settings → SEO & AI rules for a shop. Route actions that generate AI
 * content apply them for the rest of the request with:
 *
 *   enterAiWritingRules(await loadShopAiWritingRules(shop));
 *
 * enterAiWritingRules must be called in the action itself (not inside this
 * async helper) so the AsyncLocalStorage context reaches later awaits.
 */
export async function loadShopAiWritingRules(shop: string): Promise<AiWritingRules> {
  try {
    const config = await prisma.shopConfig.findUnique({
      where: { shop },
      select: { language: true, brandTone: true, forbiddenWords: true, defaultContentStructure: true },
    });
    return normalizeAiWritingRules(config || {});
  } catch (error) {
    // Rules improve output but must never block generation.
    console.error("Could not load AI writing rules", { shop, error });
    return normalizeAiWritingRules({});
  }
}
