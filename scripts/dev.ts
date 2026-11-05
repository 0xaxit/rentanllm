/**
 * Runs the whole stack locally: `bun dev`.
 *
 * 1. Creates .env.dev from .env.dev.example on first run (with fresh secrets).
 * 2. Starts local Postgres + Redis (packages/db/docker-compose.dev.yml) and
 *    syncs the schema.
 * 3. Starts the API (:8788), gateway (:8787) and web (:3000), with prefixed logs.
 * 4. Calls /cron/tick every DEV_TICK_SECONDS, standing in
 *    for the production scheduler.
 *
 * Ctrl+C stops everything except the Docker containers (`bun run dev:down`).
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { spawn, spawnSync } from "bun";
import type { Subprocess } from "bun";

const ROOT = path.join(import.meta.dir, "..");
const ENV_FILE = path.join(ROOT, ".env.dev");
const ENV_EXAMPLE = path.join(ROOT, ".env.dev.example");
const COMPOSE_FILE = path.join(ROOT, "packages/db/docker-compose.dev.yml");
const API_ORIGIN = "http://localhost:8788";
const MS_PER_SECOND = 1000;
const DEFAULT_TICK_SECONDS = 60;
const STARTUP_GRACE_MS = 15_000;
const SECRET_BYTES = 32;
const ENV_LINE = /^(?<key>[A-Z0-9_]+)=(?<value>.*)$/u;
/** A cron result with any non-zero count, worth logging. */
const DID_WORK = /":\s*[1-9]/u;
const GENERATED = ["SESSION_SECRET", "CRON_SECRET"] as const;

const COLORS = {
  api: "\u001B[36m",
  dev: "\u001B[90m",
  gateway: "\u001B[35m",
  tick: "\u001B[33m",
  web: "\u001B[32m",
} as const;
const RESET = "\u001B[0m";

type Source = keyof typeof COLORS;

const log = (source: Source, line: string) => {
  process.stdout.write(
    `${COLORS[source]}${source.padEnd(7)}${RESET} ${line}\n`
  );
};

/** Creates .env.dev on first run, filling the generated secrets. */
const ensureEnvFile = () => {
  if (!existsSync(ENV_FILE)) {
    copyFileSync(ENV_EXAMPLE, ENV_FILE);
    log("dev", "created .env.dev from .env.dev.example");
  }
  const lines = readFileSync(ENV_FILE, "utf-8").split("\n");
  let changed = false;
  const filled = lines.map((line) => {
    const { key, value } = ENV_LINE.exec(line)?.groups ?? {};
    if (
      key !== undefined &&
      value === "" &&
      (GENERATED as readonly string[]).includes(key)
    ) {
      changed = true;
      return `${key}=${randomBytes(SECRET_BYTES).toString("hex")}`;
    }
    return line;
  });
  if (changed) {
    writeFileSync(ENV_FILE, filled.join("\n"), { mode: 0o600 });
  }
};

const readEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const { key, value } = ENV_LINE.exec(line.trim())?.groups ?? {};
    if (key !== undefined && value !== undefined && value !== "") {
      env[key] = value;
    }
  }
  return env;
};

const run = (cmd: string[], cwd = ROOT, env?: Record<string, string>) => {
  const result = spawnSync({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stderr: "inherit",
    stdout: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (exit ${result.exitCode})`);
  }
};

const pipeLines = async (
  source: Source,
  stream: ReadableStream<Uint8Array> | null
) => {
  if (stream === null) {
    return;
  }
  let buffered = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      log(source, line);
    }
  }
  if (buffered.length > 0) {
    log(source, buffered);
  }
};

const children: Subprocess[] = [];

const start = (
  source: Source,
  cmd: string[],
  cwd: string,
  env: Record<string, string>
) => {
  const child = spawn({
    cmd,
    cwd: path.join(ROOT, cwd),
    env: { ...process.env, ...env, FORCE_COLOR: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });
  children.push(child);
  pipeLines(source, child.stdout).catch(() => null);
  pipeLines(source, child.stderr).catch(() => null);
  child.exited
    .then((code) => log(source, `exited (${code})`))
    .catch(() => null);
};

const callCron = async (job: string, cronSecret: string) => {
  try {
    const response = await fetch(`${API_ORIGIN}/cron/${job}`, {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const body = await response.text();
    if (!response.ok) {
      log("tick", `${job} ${response.status} ${body.slice(0, 200)}`);
    } else if (DID_WORK.test(body)) {
      log("tick", `${job} ${body}`);
    }
  } catch {
    log("tick", `${job}: API not reachable yet`);
  }
};

const stopAll = () => {
  for (const child of children) {
    child.kill();
  }
};

const main = () => {
  ensureEnvFile();
  const env = readEnv();
  const cronSecret = env.CRON_SECRET;
  if (cronSecret === undefined) {
    throw new Error("CRON_SECRET is missing from .env.dev");
  }

  log("dev", "starting Postgres + Redis");
  run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"]);
  log("dev", "syncing schema");
  run(["bun", "run", "db:sync"], path.join(ROOT, "packages/db"), env);

  start("api", ["bun", "run", "dev"], "apps/api", env);
  start("gateway", ["bun", "run", "dev"], "apps/gateway", env);
  start("web", ["bun", "run", "dev", "--port", "3000"], "apps/web", env);

  const tickMs =
    Number(env.DEV_TICK_SECONDS ?? DEFAULT_TICK_SECONDS) * MS_PER_SECOND;
  const tick = () => {
    callCron("tick", cronSecret).catch(() => null);
  };
  setTimeout(() => {
    tick();
    setInterval(tick, tickMs);
  }, STARTUP_GRACE_MS);

  log("dev", "web http://localhost:3000 · api :8788 · gateway :8787");
  process.once("SIGINT", () => {
    stopAll();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    stopAll();
    process.exit(0);
  });
};

main();
