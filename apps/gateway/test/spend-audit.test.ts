import { ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { Settings, SettingsFromEnv } from "../src/config.ts";
import { AUDIT_VERSION, auditMessage } from "../src/market/spend-audit.ts";

const ENTRY = {
  amount: 14n,
  asset: "0.0.429274",
  at: new Date("2026-11-06T00:00:00.000Z"),
  maxTokens: 64,
  model: "llama3.1:8b",
  network: "hedera:testnet",
  payTo: "0.0.11331176",
  payer: "0.0.11331175",
  requestId: "req_1",
  status: "ok",
  tx: "0.0.9185802@1793922799.072231068",
};

const auditSettings = (env: Record<string, string>) =>
  Effect.runPromise(
    Effect.gen(function* readSettings() {
      return (yield* Settings).market?.audit ?? null;
    }).pipe(
      Effect.provide(SettingsFromEnv),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))
    )
  );

describe("spend audit log", () => {
  it("posts one compact JSON message per payment, amounts in micro-USDC", () => {
    const message = JSON.parse(auditMessage(ENTRY));
    expect(message).toEqual({
      amount: "14",
      asset: "0.0.429274",
      at: "2026-11-06T00:00:00.000Z",
      maxTokens: 64,
      model: "llama3.1:8b",
      network: "hedera:testnet",
      payTo: "0.0.11331176",
      payer: "0.0.11331175",
      request: "req_1",
      status: "ok",
      tx: "0.0.9185802@1793922799.072231068",
      type: "payment",
      v: AUDIT_VERSION,
    });
  });

  it("refuses a message that would need several HCS chunks", () => {
    expect(() => auditMessage({ ...ENTRY, model: "x".repeat(1100) })).toThrow(
      "1024 bytes"
    );
  });

  it("is off unless the topic and the operator are all set", async () => {
    expect(await auditSettings({})).toBeNull();
    const audit = await auditSettings({
      HCS_AUDIT_TOPIC_ID: "0.0.11332573",
      HEDERA_OPERATOR_ID: "0.0.11330674",
      HEDERA_OPERATOR_KEY: "abc",
    });
    expect(audit?.topicId).toBe("0.0.11332573");
    expect(audit === null ? null : Redacted.value(audit.operatorKey)).toBe(
      "abc"
    );
    await expect(
      auditSettings({ HCS_AUDIT_TOPIC_ID: "0.0.11332573" })
    ).rejects.toThrow("HEDERA_OPERATOR_ID");
  });
});
