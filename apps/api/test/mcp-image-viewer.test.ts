/**
 * generate_image's in-chat viewer (MCP Apps): the hosted MCP server lists the viewer as
 * a ui:// resource with the MCP Apps MIME type, serves its HTML, and points the
 * generate_image tool at it, so hosts like Claude render the image next to the call.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IMAGE_VIEWER_URI, MCP_APP_MIME_TYPE } from "../src/mcp/image-viewer";
import { buildMcpServer } from "../src/mcp/server";

/** A script, stylesheet or image loaded from another origin. */
const EXTERNAL_RESOURCE = /<(?:script|link|img)[^>]+(?:src|href)="https?:/u;

const server = buildMcpServer({
  arkivOffers: () => Promise.resolve(null),
  balance: () => Promise.resolve(null),
  gatewayUrl: "http://gateway.invalid",
  icon: { sizes: ["192x192"], src: "https://api.example/icon.png" },
  recent: () => Promise.resolve([]),
  signer: () => Promise.resolve(null),
  walletPage: "https://rentanllm.example/budget",
  world: null,
});
const client = new Client({ name: "test", version: "1" });

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe("generate_image viewer", () => {
  it("lists the viewer as an MCP Apps resource", async () => {
    const { resources } = await client.listResources();
    expect(resources).toContainEqual(
      expect.objectContaining({
        mimeType: MCP_APP_MIME_TYPE,
        uri: IMAGE_VIEWER_URI,
      })
    );
  });

  it("serves self-contained HTML that speaks the MCP Apps protocol", async () => {
    const { contents } = await client.readResource({ uri: IMAGE_VIEWER_URI });
    const [page] = contents;
    expect(page?.mimeType).toBe(MCP_APP_MIME_TYPE);
    const html = String(page && "text" in page ? page.text : "");
    expect(html).toContain("ui/initialize");
    expect(html).toContain("ui/notifications/tool-result");
    // No network: no external scripts, styles or images.
    expect(html).not.toMatch(EXTERNAL_RESOURCE);
  });

  it("points generate_image at the viewer", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "generate_image");
    expect(tool?._meta).toMatchObject({
      ui: { resourceUri: IMAGE_VIEWER_URI },
      "ui/resourceUri": IMAGE_VIEWER_URI,
    });
  });
});
