/**
 * Human approval of one agent payment through World ID Agent Pass.
 *
 *   create  -> World device authorization; the agent gets World's link + a secret
 *   check   -> polls World (at most once per interval) and validates the ID token here
 *   consume -> releases the payment once, for exactly the approved amount and payee
 *   cancel  -> the agent or person gives up; nothing can be released afterwards
 *
 * Only `approved` can be consumed. `denied`, `expired`, `cancelled` and `failed` (an ID
 * token that did not validate, or World erroring) never release a payment.
 */
import { Conflict, NotFound, Unavailable } from "@rentanllm/api-contract";
import type { Approval } from "@rentanllm/api-contract";
import { Effect } from "effect";

import { currentDate } from "../clock";
import { randomToken, safeEqual, sha256Hex } from "../crypto";
import { ApprovalStore } from "../world/approval-store";
import type { ApprovalPatch, ApprovalRow } from "../world/approval-store";
import { WorldUnavailableError } from "../world/idp";
import type { PollResult } from "../world/idp";
import { WorldIdpService } from "../world/world-idp-service";

/** An approval (and its World attempt) lasts at most this long, approved or not. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
const MS_PER_SECOND = 1000;
/** RFC 8628: after slow_down, poll 5 seconds less often. */
const SLOW_DOWN_SECONDS = 5;

const toApproval = (row: ApprovalRow): Approval => ({
  amountUsdc: row.amountMicros,
  createdAt: row.createdAt,
  decidedAt: row.decidedAt,
  description: row.description,
  expiresAt: row.expiresAt,
  failureReason: row.failureReason,
  id: row.id,
  network: row.network,
  payTo: row.payTo,
  payer: row.payer,
  status: row.status,
  usedAt: row.usedAt,
  userCode: row.userCode,
  verificationUri: row.verificationUri,
  verificationUriComplete: row.verificationUriComplete,
  worldSubject: row.worldSubject,
});

const worldIdp = Effect.gen(function* worldIdpGen() {
  const idp = yield* WorldIdpService;
  if (idp === null) {
    return yield* new Unavailable({
      message:
        "World ID approvals are not configured on this server (WORLD_ID_CLIENT_ID / WORLD_ID_CLIENT_SECRET)",
    });
  }
  return idp;
});

const fromWorld = <A>(thunk: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) =>
      new Unavailable({
        message:
          error instanceof WorldUnavailableError
            ? error.message
            : `World ID failed: ${String(error)}`,
      }),
    try: thunk,
  });

const ended = (now: Date): ApprovalPatch => ({
  decidedAt: now,
  deviceCode: null,
});

/**
 * Who may read and use an approval: whoever holds its secret (the local MCP server), or
 * the signed-in user it belongs to (the hosted connector, which never hands out a secret).
 */
export type ApprovalCredential =
  | { readonly secret: string }
  | { readonly ownerUserId: string };

export const createApproval = Effect.fn("approvals.create")(
  function* createApprovalGen(input: {
    readonly amountUsdc: bigint;
    readonly description: string;
    readonly expectedSubject?: string;
    readonly network: string;
    /** Set for hosted-connector approvals; the user's first approver is then pinned. */
    readonly ownerUserId?: string;
    readonly payTo: string;
    readonly payer: string;
  }) {
    const idp = yield* worldIdp;
    const store = yield* ApprovalStore;
    const ownerUserId = input.ownerUserId ?? null;
    const pinned =
      ownerUserId === null ? null : yield* store.pinnedSubject(ownerUserId);
    const expectedSubject = input.expectedSubject ?? pinned;
    const device = yield* fromWorld(() =>
      idp.startDeviceAuthorization({ expectedSubject })
    );
    const now = yield* currentDate;
    const secret = randomToken();
    const row = yield* store.insert({
      amountMicros: input.amountUsdc,
      createdAt: now,
      description: input.description,
      deviceCode: device.deviceCode,
      expectedSubject,
      expiresAt: new Date(
        now.getTime() +
          Math.min(APPROVAL_TTL_MS, device.expiresInSeconds * MS_PER_SECOND)
      ),
      network: input.network,
      nextPollAt: new Date(
        now.getTime() + device.intervalSeconds * MS_PER_SECOND
      ),
      ownerUserId,
      payTo: input.payTo,
      payer: input.payer,
      pollIntervalSeconds: device.intervalSeconds,
      secretHash: sha256Hex(secret),
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
    });
    return { approval: toApproval(row), secret };
  }
);

const allows = (row: ApprovalRow, credential: ApprovalCredential): boolean =>
  "secret" in credential
    ? safeEqual(row.secretHash, sha256Hex(credential.secret))
    : row.ownerUserId === credential.ownerUserId;

/** The approval, if `credential` may use it. Otherwise it looks like a missing approval. */
const authorized = Effect.fn("approvals.authorized")(function* authorizedGen(
  id: string,
  credential: ApprovalCredential
) {
  const store = yield* ApprovalStore;
  const row = yield* store.find(id);
  if (row === undefined || !allows(row, credential)) {
    return yield* new NotFound({ message: `no approval ${id}` });
  }
  return row;
});

/** Moves `row` out of `from`; if another request moved it first, returns the fresh row. */
const transition = Effect.fn("approvals.transition")(function* transitionGen(
  row: ApprovalRow,
  patch: ApprovalPatch
) {
  const store = yield* ApprovalStore;
  const moved = yield* store.transition(row.id, row.status, patch);
  return moved ?? (yield* store.find(row.id)) ?? row;
});

const patchForPoll = (
  row: ApprovalRow,
  result: PollResult,
  now: Date
): ApprovalPatch => {
  switch (result.kind) {
    case "pending": {
      return {
        nextPollAt: new Date(
          now.getTime() + row.pollIntervalSeconds * MS_PER_SECOND
        ),
      };
    }
    case "slow_down": {
      const interval = row.pollIntervalSeconds + SLOW_DOWN_SECONDS;
      return {
        nextPollAt: new Date(now.getTime() + interval * MS_PER_SECOND),
        pollIntervalSeconds: interval,
      };
    }
    case "denied": {
      return { ...ended(now), status: "denied" };
    }
    case "expired": {
      return { ...ended(now), status: "expired" };
    }
    case "failed": {
      return { ...ended(now), failureReason: result.reason, status: "failed" };
    }
    case "approved": {
      return {
        ...ended(now),
        acr: result.identity.acr,
        amr: result.identity.amr,
        authTime: result.identity.authTime,
        status: "approved",
        worldSubject: result.identity.subject,
      };
    }
    default: {
      return result satisfies never;
    }
  }
};

/** Brings a pending or approved row up to date: expiry, then one poll of World if due. */
const refresh = Effect.fn("approvals.refresh")(function* refreshGen(
  row: ApprovalRow
) {
  const now = yield* currentDate;
  const live = row.status === "pending" || row.status === "approved";
  if (live && row.expiresAt <= now) {
    return yield* transition(row, { ...ended(now), status: "expired" });
  }
  if (
    row.status !== "pending" ||
    row.deviceCode === null ||
    now < row.nextPollAt
  ) {
    return row;
  }
  const idp = yield* worldIdp;
  const { deviceCode } = row;
  const result = yield* fromWorld(() =>
    idp.poll(deviceCode, {
      attemptStartedAt: row.createdAt,
      expectedSubject: row.expectedSubject,
      now,
    })
  );
  return yield* transition(row, patchForPoll(row, result, now));
});

export const checkApproval = Effect.fn("approvals.check")(
  function* checkApprovalGen(id: string, credential: ApprovalCredential) {
    const row = yield* authorized(id, credential);
    return toApproval(yield* refresh(row));
  }
);

export const consumeApproval = Effect.fn("approvals.consume")(
  function* consumeApprovalGen(
    id: string,
    input: {
      readonly amountUsdc: bigint;
      readonly credential: ApprovalCredential;
      readonly payTo: string;
    }
  ) {
    const row = yield* refresh(yield* authorized(id, input.credential));
    if (row.status !== "approved") {
      return yield* new Conflict({
        message: `approval ${id} is ${row.status}, not approved; no payment may be made with it`,
      });
    }
    if (row.amountMicros !== input.amountUsdc || row.payTo !== input.payTo) {
      return yield* new Conflict({
        message: `approval ${id} is for ${row.amountMicros} micro-USDC to ${row.payTo}, not ${input.amountUsdc} to ${input.payTo}`,
      });
    }
    const store = yield* ApprovalStore;
    const used = yield* store.consume({
      amountMicros: input.amountUsdc,
      id,
      now: yield* currentDate,
      payTo: input.payTo,
    });
    if (used === undefined) {
      return yield* new Conflict({
        message: `approval ${id} was already used or has expired`,
      });
    }
    return toApproval(used);
  }
);

export const cancelApproval = Effect.fn("approvals.cancel")(
  function* cancelApprovalGen(id: string, credential: ApprovalCredential) {
    const row = yield* authorized(id, credential);
    if (row.status !== "pending" && row.status !== "approved") {
      return yield* new Conflict({
        message: `approval ${id} is already ${row.status}`,
      });
    }
    const now = yield* currentDate;
    const cancelled = yield* transition(row, {
      ...ended(now),
      status: "cancelled",
    });
    if (cancelled.status !== "cancelled") {
      return yield* new Conflict({
        message: `approval ${id} became ${cancelled.status} before it could be cancelled`,
      });
    }
    return toApproval(cancelled);
  }
);
