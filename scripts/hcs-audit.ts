#!/usr/bin/env bun
/**
 * Reads RentAnLLM's spend audit log straight from a Hedera mirror node. No account and
 * no key needed:
 *
 *   bun scripts/hcs-audit.ts                     every payment on the log
 *   bun scripts/hcs-audit.ts 0.0.11331175        one buyer's payments and their total
 *   HCS_AUDIT_TOPIC_ID=0.0.x bun scripts/hcs-audit.ts
 *
 * Each line is one HCS message: its sequence number and consensus time (set by Hedera,
 * not by us), the payment it records, and the topic's running hash after it. The running
 * hash chains every message to all the ones before it, so the log cannot be edited or
 * trimmed without the hashes changing.
 */
const TOPIC = process.env.HCS_AUDIT_TOPIC_ID ?? "0.0.11332573";
const MIRROR =
  process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
const PAGE = 100;
const MICROS_PER_USDC = 1_000_000;

interface MirrorMessage {
  readonly consensus_timestamp: string;
  readonly message: string;
  readonly running_hash: string;
  readonly sequence_number: number;
}

interface Payment {
  readonly amount: string;
  readonly model: string;
  readonly payTo: string;
  readonly payer: string | null;
  readonly status: string;
  readonly tx: string;
  readonly type: string;
}

const [payerFilter] = process.argv.slice(2);

/** Mirror node pages must be followed in order: each one names the next. */
const readFrom = async (path: string | null): Promise<MirrorMessage[]> => {
  if (path === null) {
    return [];
  }
  const response = await fetch(`${MIRROR}${path}`);
  if (!response.ok) {
    throw new Error(
      `mirror node answered ${response.status} for topic ${TOPIC}`
    );
  }
  const body = (await response.json()) as {
    readonly links?: { readonly next?: string | null };
    readonly messages: readonly MirrorMessage[];
  };
  return [...body.messages, ...(await readFrom(body.links?.next ?? null))];
};

const messages = await readFrom(
  `/api/v1/topics/${TOPIC}/messages?limit=${PAGE}&order=asc`
);

const consensusTime = (timestamp: string) =>
  new Date(Number(timestamp.split(".")[0]) * 1000).toISOString();

let total = 0;
let shown = 0;
process.stdout.write(
  `topic ${TOPIC}: ${messages.length} message(s)${payerFilter ? `, payer ${payerFilter}` : ""}\n\n`
);
for (const m of messages) {
  const payment = JSON.parse(
    Buffer.from(m.message, "base64").toString("utf-8")
  ) as Payment;
  if (
    payment.type !== "payment" ||
    (payerFilter && payment.payer !== payerFilter)
  ) {
    continue;
  }
  shown += 1;
  total += Number(payment.amount);
  const usdc = (Number(payment.amount) / MICROS_PER_USDC).toFixed(6);
  const runningHash = Buffer.from(m.running_hash, "base64").toString("hex");
  process.stdout.write(
    `#${m.sequence_number}  ${consensusTime(m.consensus_timestamp)}  ${usdc} USDC  ${payment.payer ?? "?"} -> ${payment.payTo}  ${payment.model}  ${payment.status}\n` +
      `     tx ${payment.tx}  running hash ${runningHash.slice(0, 16)}…\n`
  );
}
process.stdout.write(
  `\n${shown} payment(s), ${(total / MICROS_PER_USDC).toFixed(6)} USDC in total\n`
);
