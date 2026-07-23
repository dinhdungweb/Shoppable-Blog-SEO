const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

class NineRouterUpstreamError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = "NineRouterUpstreamError";
  }
}

export async function createNineRouterResponseError(response: Response, operation: string) {
  const detail = (await response.text()).slice(0, 500);
  console.error("9Router upstream request failed", {
    operation,
    status: response.status,
    detail,
  });

  let publicMessage = "AI is temporarily unavailable. Please try again shortly.";
  if (response.status === 401 || response.status === 403) {
    publicMessage = "AI service authentication failed. Please contact support.";
  } else if (response.status === 402) {
    publicMessage = "The selected AI model is temporarily unavailable. Please try again shortly.";
  } else if (response.status === 408 || response.status === 429) {
    publicMessage = "AI is busy or rate-limited. Please try again shortly.";
  }
  return new NineRouterUpstreamError(publicMessage);
}

export function getPublicNineRouterErrorMessage(error: unknown, fallback: string) {
  if (error instanceof NineRouterUpstreamError) return error.publicMessage;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    console.error("9Router request timed out", { name: error.name });
    return "AI took too long to respond. Please try again.";
  }
  console.error("9Router generation failed", error);
  return fallback;
}

export async function readNineRouterJson(response: Response): Promise<any> {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    const withoutDoneMarker = body.replace(/\s*data:\s*\[DONE\]\s*$/i, "");
    if (withoutDoneMarker === body) throw error;
    return JSON.parse(withoutDoneMarker);
  }
}

export function getNineRouterGenerationOptions(model: string, temperature: number) {
  if (!isReasoningModel(model)) return { temperature };

  const configuredEffort = process.env.NINE_ROUTER_REASONING_EFFORT?.trim().toLowerCase() || "";
  const reasoningEffort = REASONING_EFFORTS.has(configuredEffort) ? configuredEffort : "low";
  return { reasoning_effort: reasoningEffort };
}

export function isReasoningModel(model: string) {
  const modelId = (model.split("/").pop() || model).trim().toLowerCase();
  return /^gpt-5(?:$|[.\-_])/.test(modelId)
    || /(?:^|[.\-_])codex(?:$|[.\-_])/.test(modelId)
    || /^o(?:1|3|4)(?:$|[.\-_])/.test(modelId);
}
