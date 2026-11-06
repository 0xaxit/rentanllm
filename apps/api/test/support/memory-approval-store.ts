import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import { ApprovalStore } from "../../src/world/approval-store";
import type { ApprovalRow } from "../../src/world/approval-store";

/** In-memory ApprovalStore with the same semantics as ApprovalStorePg. */
export const memoryApprovalStore = (rows: Map<string, ApprovalRow>) =>
  Layer.succeed(ApprovalStore)(
    ApprovalStore.of({
      consume: ({ amountMicros, id, now, payTo }) =>
        Effect.sync(() => {
          const row = rows.get(id);
          if (
            row === undefined ||
            row.status !== "approved" ||
            row.amountMicros !== amountMicros ||
            row.payTo !== payTo ||
            row.expiresAt <= now
          ) {
            return;
          }
          const used: ApprovalRow = { ...row, status: "used", usedAt: now };
          rows.set(id, used);
          return used;
        }),
      find: (id) => Effect.sync(() => rows.get(id)),
      insert: (input) =>
        Effect.sync(() => {
          const row: ApprovalRow = {
            acr: input.acr ?? null,
            amountMicros: input.amountMicros,
            amr: input.amr ?? null,
            authTime: input.authTime ?? null,
            createdAt: input.createdAt ?? new Date(),
            decidedAt: input.decidedAt ?? null,
            description: input.description,
            deviceCode: input.deviceCode ?? null,
            expectedSubject: input.expectedSubject ?? null,
            expiresAt: input.expiresAt,
            failureReason: input.failureReason ?? null,
            id: input.id ?? randomUUID(),
            network: input.network,
            nextPollAt: input.nextPollAt,
            payTo: input.payTo,
            payer: input.payer,
            pollIntervalSeconds: input.pollIntervalSeconds,
            secretHash: input.secretHash,
            status: input.status ?? "pending",
            usedAt: input.usedAt ?? null,
            userCode: input.userCode,
            verificationUri: input.verificationUri,
            verificationUriComplete: input.verificationUriComplete ?? null,
            worldSubject: input.worldSubject ?? null,
          };
          rows.set(row.id, row);
          return row;
        }),
      transition: (id, fromStatus, patch) =>
        Effect.sync(() => {
          const row = rows.get(id);
          if (row === undefined || row.status !== fromStatus) {
            return;
          }
          const next: ApprovalRow = { ...row, ...patch };
          rows.set(id, next);
          return next;
        }),
    })
  );
