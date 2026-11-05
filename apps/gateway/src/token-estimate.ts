/**
 * The gateway's own rough output-token count, used to cross-check the provider's usage.
 * It counts characters of generated content (text, tool input JSON, thinking) and assumes
 * about four characters per token. It is a sanity check, never a billing source.
 */

const CHARS_PER_TOKEN = 4;
/** Cap on how much of a non-streaming body is kept for counting. */
const MAX_BUFFERED_CHARS = 4 * 1024 * 1024;
const EVENT_SEPARATOR = /\r?\n\r?\n/u;
const LINE_SEPARATOR = /\r?\n/u;

interface ContentDelta {
  readonly partial_json?: unknown;
  readonly text?: unknown;
  readonly thinking?: unknown;
}

const deltaChars = (delta: ContentDelta | undefined): number => {
  if (delta === undefined) {
    return 0;
  }
  let chars = 0;
  for (const value of [delta.text, delta.partial_json, delta.thinking]) {
    if (typeof value === "string") {
      chars += value.length;
    }
  }
  return chars;
};

interface ContentBlock {
  readonly input?: unknown;
  readonly text?: unknown;
  readonly thinking?: unknown;
  readonly type?: unknown;
}

const blockChars = (block: ContentBlock): number => {
  let chars = deltaChars({ text: block.text, thinking: block.thinking });
  if (block.type === "tool_use" && block.input !== undefined) {
    chars += JSON.stringify(block.input).length;
  }
  return chars;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export interface TokenCounter {
  /** Rough output-token estimate from what has been seen so far. */
  readonly estimate: () => number;
  /** Feed response text exactly as forwarded to the renter. */
  readonly feed: (text: string) => void;
}

interface ChatChoice {
  readonly delta?: { readonly content?: unknown };
  readonly message?: { readonly content?: unknown };
}

/** Characters of generated text in OpenAI chat-completions `choices` (chunk or full body). */
const choiceChars = (choices: unknown): number => {
  if (!Array.isArray(choices)) {
    return 0;
  }
  let chars = 0;
  for (const choice of choices as ChatChoice[]) {
    const content = choice.delta?.content ?? choice.message?.content;
    if (typeof content === "string") {
      chars += content.length;
    }
  }
  return chars;
};

const countSseEvent = (event: string): number => {
  let chars = 0;
  for (const line of event.split(LINE_SEPARATOR)) {
    if (line.startsWith("data:")) {
      const payload = parseJson(line.slice("data:".length).trim()) as {
        choices?: unknown;
        delta?: ContentDelta;
        type?: unknown;
      } | null;
      if (payload?.type === "content_block_delta") {
        chars += deltaChars(payload.delta);
      } else if (payload?.choices !== undefined) {
        chars += choiceChars(payload.choices);
      }
    }
  }
  return chars;
};

/** Counter for `text/event-stream` bodies (Anthropic events or OpenAI chat chunks). */
export const makeSseTokenCounter = (): TokenCounter => {
  let pending = "";
  let chars = 0;
  return {
    estimate: () =>
      Math.ceil((chars + countSseEvent(pending)) / CHARS_PER_TOKEN),
    feed: (text) => {
      pending += text;
      const events = pending.split(EVENT_SEPARATOR);
      pending = events.pop() ?? "";
      for (const event of events) {
        chars += countSseEvent(event);
      }
    },
  };
};

/** Counter for a non-streaming JSON Messages or chat-completions response. */
export const makeJsonTokenCounter = (): TokenCounter => {
  let body = "";
  return {
    estimate: () => {
      const parsed = parseJson(body) as {
        choices?: unknown;
        content?: unknown;
      } | null;
      if (parsed?.choices !== undefined) {
        return Math.ceil(choiceChars(parsed.choices) / CHARS_PER_TOKEN);
      }
      if (!Array.isArray(parsed?.content)) {
        return 0;
      }
      let chars = 0;
      for (const block of parsed.content as ContentBlock[]) {
        chars += blockChars(block);
      }
      return Math.ceil(chars / CHARS_PER_TOKEN);
    },
    feed: (text) => {
      if (body.length < MAX_BUFFERED_CHARS) {
        body += text;
      }
    },
  };
};

/** Absolute slack plus relative slack before a mismatch is worth a warning. */
const MISMATCH_ABSOLUTE_TOKENS = 64;
const MISMATCH_RELATIVE = 0.5;

/** Rough input-token count of a request body: every message's text, ~4 chars per token. */
export const estimateInputTokens = (messages: unknown): number => {
  if (!Array.isArray(messages)) {
    return 0;
  }
  let chars = 0;
  for (const message of messages as { content?: unknown }[]) {
    const { content } = message;
    if (typeof content === "string") {
      chars += content.length;
    } else if (content !== undefined) {
      chars += JSON.stringify(content).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
};

export const isLargeMismatch = (reported: number, estimated: number) =>
  Math.abs(reported - estimated) >
  Math.max(MISMATCH_ABSOLUTE_TOKENS, reported * MISMATCH_RELATIVE);
