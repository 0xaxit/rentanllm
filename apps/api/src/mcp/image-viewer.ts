/**
 * The in-chat viewer for generate_image, an MCP App (MCP Apps extension,
 * `io.modelcontextprotocol/ui`, protocol 2026-01-26). Hosts that support MCP Apps,
 * such as Claude, render this page in a sandboxed iframe next to the tool call and send
 * it the tool's input and result over postMessage (JSON-RPC 2.0). The page draws the
 * image from the result's image block as a data: URL, so it needs no network access.
 * Hosts without MCP Apps ignore it and still get the image and text blocks.
 */

export const IMAGE_VIEWER_URI = "ui://rentanllm/image-viewer.html";
/** The MIME type MCP Apps hosts look for on a UI resource. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** Tool `_meta` that points a host at the viewer: the current key and the older flat one. */
export const imageViewerToolMeta = {
  ui: { resourceUri: IMAGE_VIEWER_URI },
  "ui/resourceUri": IMAGE_VIEWER_URI,
} as const;

/** What generate_image puts in structuredContent for the viewer. */
export interface ImageCaption {
  readonly model: string;
  readonly payment: {
    readonly amount_usdc: string;
    readonly from: string;
    readonly to: string;
    readonly transaction: string | null;
    readonly url: string | null;
  };
  readonly prompt: string;
  readonly size: string;
}

export const imageViewerHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RentAnLLM image</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1d1d1b; --muted: #6b6a66; --line: #e4e2dc; --accent: #c76a12;
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    --bg: #1f1f1e; --fg: #f1efe9; --muted: #a3a19a; --line: #3a3936; --accent: #f3a13f;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); }
  body { font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding: 12px; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .frame { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--line); width: fit-content; max-width: 100%; }
  img { display: block; width: 100%; height: auto; max-width: 512px; }
  .wait { aspect-ratio: 1; max-width: 512px; display: grid; place-items: center; color: var(--muted); }
  figcaption { display: flex; flex-direction: column; gap: 4px; }
  .prompt { font-weight: 600; overflow-wrap: anywhere; }
  .meta { color: var(--muted); font-size: 13px; }
  .meta code { font: 12px ui-monospace, Menlo, monospace; }
  a { color: var(--accent); text-decoration: underline; cursor: pointer; }
  .error { color: #c0392b; white-space: pre-wrap; }
  @media (prefers-reduced-motion: no-preference) {
    .wait span { animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.4; } }
  }
</style>
</head>
<body>
<figure id="view">
  <div class="frame"><div class="wait"><span>Paying the seller and drawing…</span></div></div>
  <figcaption><span class="prompt" id="prompt"></span></figcaption>
</figure>
<script>
(() => {
  const PROTOCOL = "2026-01-26";
  const view = document.getElementById("view");
  let nextId = 1;
  const pending = new Map();

  const send = (message) => window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  const request = (method, params) => {
    const id = nextId++;
    send({ id, method, params });
    return new Promise((resolve) => pending.set(id, resolve));
  };
  const notify = (method, params) => send({ method, params });

  const setTheme = (context) => {
    if (context && (context.theme === "dark" || context.theme === "light")) {
      document.documentElement.dataset.theme = context.theme;
    }
  };

  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const child of children || []) node.append(child);
    return node;
  };

  const showPrompt = (text) => {
    const prompt = document.getElementById("prompt");
    if (prompt && text) prompt.textContent = text;
  };

  const render = (result) => {
    const blocks = Array.isArray(result && result.content) ? result.content : [];
    const image = blocks.find((b) => b && b.type === "image" && typeof b.data === "string");
    const text = blocks.filter((b) => b && b.type === "text").map((b) => b.text).join("\\n\\n");
    const caption = (result && result.structuredContent) || null;
    view.replaceChildren();
    if (!image) {
      view.append(el("p", { className: "error", textContent: text || "No image came back." }));
      return;
    }
    const img = el("img", {
      alt: caption ? caption.prompt : "Generated image",
      src: "data:" + (image.mimeType || "image/png") + ";base64," + image.data,
    });
    const parts = [];
    if (caption) {
      parts.push(el("span", { className: "prompt", textContent: caption.prompt }));
      const meta = el("span", { className: "meta" });
      meta.append(caption.model + " · " + caption.size + " · paid " + caption.payment.amount_usdc + " USDC to " + caption.payment.to);
      if (caption.payment.url) {
        const link = el("a", { href: caption.payment.url, textContent: "View on HashScan" });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          request("ui/open-link", { url: caption.payment.url });
        });
        meta.append(" · ", link);
      }
      parts.push(meta);
    } else if (text) {
      parts.push(el("span", { className: "meta", textContent: text }));
    }
    view.append(el("div", { className: "frame" }, [img]), el("figcaption", {}, parts));
    img.addEventListener("load", reportSize);
  };

  const reportSize = () => {
    notify("ui/notifications/size-changed", {
      height: Math.ceil(document.documentElement.scrollHeight),
    });
  };
  new ResizeObserver(reportSize).observe(document.body);

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && !message.method) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      if (resolve) resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-input") {
      showPrompt(message.params && message.params.arguments && message.params.arguments.prompt);
    } else if (message.method === "ui/notifications/tool-result") {
      render(message.params);
    } else if (message.method === "ui/notifications/host-context-changed") {
      setTheme(message.params);
    } else if (message.method === "ui/resource-teardown" && message.id !== undefined) {
      send({ id: message.id, result: {} });
    }
  });

  request("ui/initialize", {
    appCapabilities: {},
    appInfo: { name: "rentanllm-image-viewer", version: "1.0.0" },
    protocolVersion: PROTOCOL,
  }).then((result) => {
    setTheme(result && result.hostContext);
    notify("ui/notifications/initialized", {});
    reportSize();
  });
})();
</script>
</body>
</html>
`;
