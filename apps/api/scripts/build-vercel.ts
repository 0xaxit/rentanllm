/**
 * Builds the API for Vercel with the Build Output API v3 (`bun run build`):
 *   .vercel/output/functions/index.func/index.mjs   one bundled Node.js function
 *   .vercel/output/functions/index.func/.vc-config.json   runtime, maxDuration
 *   .vercel/output/config.json   route every path to it (crons come from vercel.json)
 *
 * Bundling is required: the workspace packages export TypeScript sources with
 * extensionless ESM imports, which Node cannot load as-is.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Node.js runtime and limits of the function (seconds). Payout runs wait for receipts. */
export const FUNCTION_CONFIG = {
  handler: "index.mjs",
  launcherType: "Nodejs",
  maxDuration: 300,
  runtime: "nodejs22.x",
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
} as const;

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".vercel/output");
const functionDir = path.join(output, "functions/index.func");

rmSync(output, { force: true, recursive: true });
mkdirSync(functionDir, { recursive: true });

const bundle = spawnSync(
  "bun",
  [
    "build",
    path.join(root, "src/vercel.ts"),
    "--target=node",
    "--format=esm",
    "--sourcemap=linked",
    `--outdir=${functionDir}`,
    "--entry-naming=index.mjs",
  ],
  { stdio: "inherit" }
);
if (bundle.status !== 0) {
  process.exit(bundle.status ?? 1);
}

writeFileSync(
  path.join(functionDir, ".vc-config.json"),
  `${JSON.stringify(FUNCTION_CONFIG, null, 2)}\n`
);
writeFileSync(
  path.join(functionDir, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`
);

// Crons stay in vercel.json only: Vercel registers them from there, and listing
// them here as well fails the deploy as duplicates.
writeFileSync(
  path.join(output, "config.json"),
  `${JSON.stringify(
    {
      routes: [{ dest: "/index", src: "/(.*)" }],
      version: 3,
    },
    null,
    2
  )}\n`
);
process.stdout.write(`Built ${path.relative(root, output)}\n`);
