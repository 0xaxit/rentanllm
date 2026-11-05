#!/usr/bin/env bun
/**
 * rentanllm-mcp: an MCP server (stdio) that lets an agent in Claude, Cursor or any MCP
 * client buy inference on the RentAnLLM market, one request at a time, with Touch ID
 * approval for every payment.
 *
 *   rentanllm-mcp                 serve over stdio (what an MCP client runs)
 *   rentanllm-mcp store-key       read the payer's private key from stdin into the keychain
 *   rentanllm-mcp key-status      say whether a key is stored
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, keychainAccount, loadConfig } from "./config.ts";
import type { McpConfig } from "./config.ts";
import { registerTools } from "./tools.ts";

const VERSION = "0.0.1";

const signer = (config: McpConfig, args: readonly string[], input?: string) =>
  execFileSync(config.signerPath, [...args], {
    encoding: "utf-8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  }).trim();

const main = async () => {
  const config = loadConfig();
  const [command] = process.argv.slice(2);
  if (command === "store-key") {
    const key = readFileSync(0, "utf-8").trim();
    process.stdout.write(
      `${signer(config, ["store", keychainAccount(config)], key)} (${keychainAccount(config)})\n`
    );
    return;
  }
  if (command === "key-status") {
    process.stdout.write(
      `${signer(config, ["status", keychainAccount(config)])} (${keychainAccount(config)})\n`
    );
    return;
  }
  const server = new McpServer({ name: "rentanllm", version: VERSION });
  registerTools(server, config);
  await server.connect(new StdioServerTransport());
};

try {
  await main();
} catch (error) {
  // stdout belongs to the MCP protocol; problems go to stderr.
  process.stderr.write(
    `rentanllm-mcp: ${error instanceof ConfigError ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
