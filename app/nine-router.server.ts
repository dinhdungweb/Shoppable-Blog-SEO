const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

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
