/**
 * The spend audit log: every settled payment becomes one message on a Hedera Consensus
 * Service topic. Hedera orders the messages, stamps each with a consensus time and a
 * sequence number, and chains them with a running hash, so the log cannot be rewritten
 * or trimmed without it showing. Only the operator's submit key can post; anyone can
 * read the topic from a mirror node.
 *
 * The log is a public record, never a dependency: a failed post is logged and the
 * market carries on. The message's sequence number is saved on the paid request.
 */
import {
  AccountId,
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import type { Micros } from "@rentanllm/core";
import { Context, Effect, Layer, Redacted } from "effect";

import { Settings } from "../config.ts";
import type { AuditSettings } from "../config.ts";
import { MarketStore } from "../services/market-store.ts";

/** Bumped when the message layout changes. */
export const AUDIT_VERSION = 1;
/** HCS splits anything longer into chunks; one payment stays far below it. */
const MAX_MESSAGE_BYTES = 1024;
const DER_PREFIX = /^30[0-9a-f]{2}/iu;

export interface SpendEntry {
  readonly amount: Micros;
  readonly asset: string;
  readonly at: Date;
  readonly maxTokens: number;
  readonly model: string;
  readonly network: string;
  readonly payTo: string;
  readonly payer: string | null;
  readonly requestId: string;
  /** "ok" | "error" | "cancelled": how the paid request ended. */
  readonly status: string;
  /** The settlement transaction id. */
  readonly tx: string;
}

/** The message posted for one payment: compact JSON, amounts as micro-USDC strings. */
export const auditMessage = (entry: SpendEntry): string => {
  const message = JSON.stringify({
    amount: entry.amount.toString(),
    asset: entry.asset,
    at: entry.at.toISOString(),
    maxTokens: entry.maxTokens,
    model: entry.model,
    network: entry.network,
    payTo: entry.payTo,
    payer: entry.payer,
    request: entry.requestId,
    status: entry.status,
    tx: entry.tx,
    type: "payment",
    v: AUDIT_VERSION,
  });
  if (Buffer.byteLength(message, "utf-8") > MAX_MESSAGE_BYTES) {
    throw new Error(`audit message is over ${MAX_MESSAGE_BYTES} bytes`);
  }
  return message;
};

export class SpendAudit extends Context.Service<
  SpendAudit,
  {
    /** Posts one payment to the topic in the background. Never fails. */
    readonly record: (entry: SpendEntry) => Effect.Effect<void>;
  }
>()("@rentanllm/gateway/SpendAudit") {}

const SpendAuditOff = Layer.succeed(SpendAudit)({ record: () => Effect.void });

const operatorKey = (raw: string): PrivateKey =>
  DER_PREFIX.test(raw) && raw.length > 70
    ? PrivateKey.fromStringDer(raw)
    : PrivateKey.fromStringECDSA(raw);

const makeAudit = (audit: AuditSettings) =>
  Effect.gen(function* makeSpendAudit() {
    const store = yield* MarketStore;
    const client = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Client.forTestnet().setOperator(
          AccountId.fromString(audit.operatorId),
          operatorKey(Redacted.value(audit.operatorKey))
        )
      ),
      (c) => Effect.sync(() => c.close())
    );
    yield* Effect.logInfo("posting the spend audit log to HCS").pipe(
      Effect.annotateLogs({ topic: audit.topicId })
    );
    const post = (entry: SpendEntry) =>
      Effect.tryPromise(async () => {
        const response = await new TopicMessageSubmitTransaction()
          .setTopicId(audit.topicId)
          .setMessage(auditMessage(entry))
          .execute(client);
        const receipt = await response.getReceipt(client);
        return Number(receipt.topicSequenceNumber ?? 0);
      });
    return {
      record: (entry: SpendEntry) =>
        post(entry).pipe(
          Effect.tap((sequence) =>
            store.recordAuditSequence(entry.requestId, sequence)
          ),
          Effect.tap((sequence) =>
            Effect.logInfo("spend audit message posted").pipe(
              Effect.annotateLogs({
                requestId: entry.requestId,
                sequence,
                topic: audit.topicId,
              })
            )
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("spend audit message failed", cause)
          ),
          Effect.forkDetach,
          Effect.asVoid
        ),
    };
  });

/** Posts to HCS when the market and the audit settings are both set; otherwise a no-op. */
export const SpendAuditLive = Layer.unwrap(
  Effect.gen(function* chooseSpendAudit() {
    const { market } = yield* Settings;
    if (market === null || market.audit === null) {
      return SpendAuditOff;
    }
    return Layer.effect(SpendAudit)(makeAudit(market.audit));
  })
);
