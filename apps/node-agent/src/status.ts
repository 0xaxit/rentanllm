/**
 * `status.json` in the config dir: a snapshot the running agent rewrites so that
 * `ral status` can report on it. Contains no secrets.
 */
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { Provider, UsageMeters } from "@rentanllm/protocol";
import { Effect, Ref } from "effect";

import { NodeConfig } from "./config.ts";
import { MeterReader } from "./meters.ts";
import { Providers } from "./providers/registry.ts";
import { NodeState } from "./state.ts";
import type { Availability, ConnectionStatus } from "./state.ts";
import { WakeLock } from "./wake-lock.ts";

export interface StatusSnapshot {
  readonly agentVersion: string;
  readonly availability: Availability;
  readonly circuitOpenUntil: Partial<Record<Provider, string>>;
  readonly connection: ConnectionStatus;
  readonly gatewayUrl: string;
  readonly inFlight: number;
  readonly meters: Partial<Record<Provider, UsageMeters | null>>;
  readonly nodeId: string;
  readonly pid: number;
  readonly updatedAt: string;
  readonly wakeLockHeld: boolean;
}

export const statusFilePath = (configDir: string): string =>
  path.join(configDir, "status.json");

export const writeStatus = (agentVersion: string) =>
  Effect.gen(function* writeStatusProgram() {
    const config = yield* NodeConfig;
    const state = yield* NodeState;
    const providers = yield* Providers;
    const meterReader = yield* MeterReader;
    const wakeLock = yield* WakeLock;

    const meters: Partial<Record<Provider, UsageMeters | null>> = {};
    for (const provider of providers.adapters.keys()) {
      meters[provider] = yield* meterReader.read(provider);
    }
    const circuitOpenUntil: Partial<Record<Provider, string>> = {};
    for (const [provider, until] of yield* Ref.get(state.circuitOpenUntil)) {
      if (until > Date.now()) {
        circuitOpenUntil[provider] = new Date(until).toISOString();
      }
    }
    const snapshot: StatusSnapshot = {
      agentVersion,
      availability: yield* Ref.get(state.availability),
      circuitOpenUntil,
      connection: yield* Ref.get(state.connection),
      gatewayUrl: config.gatewayUrl,
      inFlight: yield* Ref.get(state.inFlight),
      meters,
      nodeId: config.nodeId,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
      wakeLockHeld: yield* wakeLock.isHeld,
    };
    yield* Effect.try(() => {
      mkdirSync(config.configDir, { mode: 0o700, recursive: true });
      const target = statusFilePath(config.configDir);
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, {
        mode: 0o600,
      });
      renameSync(tmp, target);
    }).pipe(Effect.ignore);
  });

/** Formats an ISO timestamp in the machine's local timezone. */
const localTime = (iso: string | null): string =>
  iso === null
    ? "never"
    : new Date(iso).toLocaleString(undefined, { timeZoneName: "short" });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Human-readable status report from the snapshot file. */
export const formatStatus = (configDir: string): string => {
  let snapshot: StatusSnapshot;
  try {
    snapshot = JSON.parse(
      readFileSync(statusFilePath(configDir), "utf-8")
    ) as StatusSnapshot;
  } catch {
    return `No status found in ${configDir}. Is the agent running? Start it with: ral start`;
  }
  const running = isAlive(snapshot.pid);
  const { availability, connection } = snapshot;
  const lines = [
    `agent:      ${running ? `running (pid ${snapshot.pid})` : "not running (last snapshot shown)"}`,
    `version:    ${snapshot.agentVersion}`,
    `node id:    ${snapshot.nodeId}`,
    `gateway:    ${snapshot.gatewayUrl}`,
    `connected:  ${connection.connected ? `yes, since ${localTime(connection.connectedAt)}` : `no${connection.lastError ? ` (${connection.lastError})` : ""}`}`,
    `heartbeat:  ${localTime(connection.lastHeartbeatAt)}`,
    `reconnects: ${connection.reconnects}`,
    `open:       ${availability.open ? `yes (cut-offs: session ${availability.sessionCutoffPct}%, weekly ${availability.weeklyCutoffPct}%)` : "no"}`,
    `in flight:  ${snapshot.inFlight}`,
    `wake lock:  ${snapshot.wakeLockHeld ? "held" : "released"}`,
  ];
  for (const [provider, m] of Object.entries(snapshot.meters)) {
    lines.push(
      m
        ? `meters:     ${provider} session ${m.sessionUsedPct ?? "?"}% weekly ${m.weeklyUsedPct ?? "?"}% (read ${localTime(m.readAt)})`
        : `meters:     ${provider} unreadable`
    );
  }
  for (const [provider, until] of Object.entries(snapshot.circuitOpenUntil)) {
    lines.push(`cooling off: ${provider} until ${localTime(until)}`);
  }
  lines.push(`updated:    ${localTime(snapshot.updatedAt)}`);
  return lines.join("\n");
};
