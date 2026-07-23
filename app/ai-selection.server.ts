import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, fetchNineRouter, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";

export type AiSelectionTask = "improve" | "shorten" | "expand" | "custom";

export type AiSelectionSuggestion = {
  replacementHtml: string;
  explanation: string;
};

type AiSelectionInput = {
  task: AiSelectionTask;
  selectionHtml: string;
  selectionText: string;
  articleContext: string;
  keywordContext: string;
  instruction: string;
};

const MAX_SELECTION_CHARS = 8_000;
const MAX_CONTEXT_CHARS = 12_000;
const LINK_PATTERN = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export function isAiSelectionTask(value: string): value is AiSelectionTask {
  return ["improve", "shorten", "expand", "custom"].includes(value);
}

export async function rewriteAiSelection(input: AiSelectionInput): Promise<AiSelectionSuggestion> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  if (!input.selectionText.trim()) throw new Error("Select text to rewrite");
  if (input.selectionHtml.length > MAX_SELECTION_CHARS) throw new Error("The selected text is too large");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000 ? Math.min(timeoutValue, 60_000) : 20_000;
  const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: false,
      ...getNineRouterGenerationOptions(model, 0.25),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "selection_rewrite",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["replacementHtml", "explanation"],
            properties: {
              replacementHtml: { type: "string" },
              explanation: { type: "string" },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You edit only the selected excerpt of an ecommerce article.",
            "Return replacementHtml and a short explanation.",
            "Preserve the original language, facts, meaning, product names, numbers, and claims unless the user's instruction explicitly changes wording.",
            "Use keywords naturally and never stuff them.",
            "replacementHtml may use only p, h2, h3, ul, ol, li, strong, em, blockquote, and a tags.",
            "Never add or remove links. Preserve every existing href exactly.",
            "Do not use h1, scripts, styles, images, iframes, forms, SVG, event attributes, inline CSS, or markdown fences.",
            input.task === "shorten" ? "Make the selection meaningfully shorter without losing essential information."
              : input.task === "expand" ? "Add useful clarity using only facts supported by the supplied context."
                : input.task === "improve" ? "Improve clarity, grammar, flow, and natural readability."
                  : "Follow the user's custom instruction while respecting every safety rule.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            selectedHtml: input.selectionHtml,
            selectedText: input.selectionText,
            articleContext: input.articleContext.slice(0, MAX_CONTEXT_CHARS),
            keywordContext: input.keywordContext.slice(0, 500),
            instruction: input.instruction.slice(0, 1_000),
          }),
        },
      ],
    }),
  }, timeoutMs);
  if (!response.ok) throw await createNineRouterResponseError(response, "selected text rewrite");
  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  const replacementHtml = typeof parsed?.replacementHtml === "string" ? parsed.replacementHtml.trim() : "";
  if (!replacementHtml) throw new Error("9Router returned an empty replacement");
  if (replacementHtml.length > MAX_SELECTION_CHARS * 2) throw new Error("9Router returned a replacement that is too large");
  if (/<\s*\/?\s*(script|style|iframe|object|embed|svg|form|input|button|img)\b/i.test(replacementHtml)
    || /\son[a-z]+\s*=/i.test(replacementHtml)
    || /\sstyle\s*=/i.test(replacementHtml)
    || /(?:javascript|data|vbscript)\s*:/i.test(replacementHtml)) throw new Error("9Router returned unsafe replacement markup");
  if (!sameStrings(extractLinks(input.selectionHtml), extractLinks(replacementHtml))) {
    throw new Error("9Router did not preserve the selected links");
  }
  return {
    replacementHtml,
    explanation: cleanLine(parsed?.explanation).slice(0, 400) || "Improves the selected text.",
  };
}

function extractLinks(html: string) {
  return [...html.matchAll(LINK_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3] ?? "").sort();
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cleanLine(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}
