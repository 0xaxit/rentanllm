/** Labels for providers and listing models. */
import type { Provider } from "./api/types";

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "CLAUDE",
  google: "GEMINI",
  ollama: "OPEN MODELS",
  openai: "CHATGPT",
  xai: "GROK",
};

export const providerLabel = (provider: Provider): string =>
  PROVIDER_LABEL[provider];

/** "opus-5.5", "opus-5.5 +2". */
export const modelsLabel = (models: readonly string[]): string => {
  const [first, ...rest] = models;
  if (first === undefined) {
    return "any model";
  }
  return rest.length > 0 ? `${first} +${rest.length}` : first;
};
