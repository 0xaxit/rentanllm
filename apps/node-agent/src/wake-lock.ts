/**
 * Keeps the machine from idle-sleeping while the node is open for rentals.
 * macOS: `caffeinate -i -w <pid>`; Linux: `systemd-inhibit` when installed; otherwise a no-op.
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { Context, Effect, Layer, Ref } from "effect";

import { NodeConfig } from "./config.ts";

export interface WakeLockShape {
  readonly isHeld: Effect.Effect<boolean>;
  /** Acquire (true) or release (false). Idempotent. */
  readonly set: (held: boolean) => Effect.Effect<void>;
}

export class WakeLock extends Context.Service<WakeLock, WakeLockShape>()(
  "rentanllm/WakeLock"
) {}

const hasCommand = (command: string): boolean =>
  spawnSync("which", [command], { stdio: "ignore" }).status === 0;

/** Returns the inhibitor command for this platform, or null when none is available. */
export const inhibitorCommand = (
  platform: NodeJS.Platform = process.platform,
  pid: number = process.pid
): readonly [string, readonly string[]] | null => {
  if (platform === "darwin") {
    // -i: prevent idle sleep; -w: exit automatically if this agent dies.
    return ["caffeinate", ["-i", "-w", String(pid)]];
  }
  if (platform === "linux" && hasCommand("systemd-inhibit")) {
    return [
      "systemd-inhibit",
      [
        "--what=idle:sleep",
        "--who=ral",
        "--why=Serving rentals",
        "--mode=block",
        "sleep",
        "infinity",
      ],
    ];
  }
  return null;
};

const stopChild = (child: ChildProcess | null): void => {
  if (child !== null && child.exitCode === null) {
    child.kill("SIGTERM");
  }
};

export const WakeLockLive = Layer.effect(
  WakeLock,
  Effect.gen(function* WakeLockLive() {
    const config = yield* NodeConfig;
    const command = config.keepAwake ? inhibitorCommand() : null;
    const child = yield* Ref.make<ChildProcess | null>(null);
    const held = yield* Ref.make(false);

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(child), (c) => Effect.sync(() => stopChild(c)))
    );

    const set = (want: boolean): Effect.Effect<void> =>
      Effect.gen(function* setProgram() {
        const current = yield* Ref.get(held);
        if (current === want) {
          return;
        }
        yield* Ref.set(held, want);
        if (command === null) {
          return;
        }
        if (want) {
          const [bin, args] = command;
          const proc = spawn(bin, [...args], { stdio: "ignore" });
          proc.on("error", () => {
            // inhibitor missing or failed: keep running without it
          });
          yield* Ref.set(child, proc);
          yield* Effect.logInfo(`wake lock acquired (${bin})`);
        } else {
          const proc = yield* Ref.getAndSet(child, null);
          stopChild(proc);
          yield* Effect.logInfo("wake lock released");
        }
      });

    return { isHeld: Ref.get(held), set };
  })
);

/** In-memory wake lock for tests. */
export const WakeLockTest = Layer.effect(
  WakeLock,
  Effect.map(Ref.make(false), (held) => ({
    isHeld: Ref.get(held),
    set: (want: boolean) => Ref.set(held, want),
  }))
);
