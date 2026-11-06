import { Db } from "@rentanllm/db";
import { worldApprovals } from "@rentanllm/db/schema";
import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

export type ApprovalRow = typeof worldApprovals.$inferSelect;
export type NewApprovalRow = typeof worldApprovals.$inferInsert;
export type ApprovalPatch = Partial<
  Omit<ApprovalRow, "createdAt" | "id" | "secretHash">
>;

export interface ApprovalStoreShape {
  /**
   * Marks an approved approval used, only if it is still approved, unexpired, and for
   * exactly this amount and payee. Undefined when it was not (already used, raced, ...).
   */
  readonly consume: (input: {
    readonly amountMicros: bigint;
    readonly id: string;
    readonly now: Date;
    readonly payTo: string;
  }) => Effect.Effect<ApprovalRow | undefined>;
  readonly find: (id: string) => Effect.Effect<ApprovalRow | undefined>;
  /** The World subject that first approved a payment for this user; null when none has. */
  readonly pinnedSubject: (ownerUserId: string) => Effect.Effect<string | null>;
  readonly insert: (row: NewApprovalRow) => Effect.Effect<ApprovalRow>;
  /** Applies `patch` only while the approval is still in `fromStatus`. */
  readonly transition: (
    id: string,
    fromStatus: ApprovalRow["status"],
    patch: ApprovalPatch
  ) => Effect.Effect<ApprovalRow | undefined>;
}

/** World ID approvals. Infrastructure failures are defects (500). */
export class ApprovalStore extends Context.Service<
  ApprovalStore,
  ApprovalStoreShape
>()("@rentanllm/api/ApprovalStore") {}

export const ApprovalStorePg = Layer.effect(ApprovalStore)(
  Effect.gen(function* makeApprovalStorePg() {
    const db = yield* Db;
    return ApprovalStore.of({
      consume: ({ amountMicros, id, now, payTo }) =>
        db
          .update(worldApprovals)
          .set({ status: "used", usedAt: now })
          .where(
            and(
              eq(worldApprovals.id, id),
              eq(worldApprovals.status, "approved"),
              eq(worldApprovals.amountMicros, amountMicros),
              eq(worldApprovals.payTo, payTo),
              gt(worldApprovals.expiresAt, now)
            )
          )
          .returning()
          .pipe(
            Effect.map(([row]) => row),
            Effect.orDie
          ),
      find: (id) =>
        db
          .select()
          .from(worldApprovals)
          .where(eq(worldApprovals.id, id))
          .limit(1)
          .pipe(
            Effect.map(([row]) => row),
            Effect.orDie
          ),
      insert: (row) =>
        db
          .insert(worldApprovals)
          .values(row)
          .returning()
          .pipe(
            Effect.flatMap(([inserted]) =>
              inserted === undefined
                ? Effect.die(new Error("approval insert returned no row"))
                : Effect.succeed(inserted)
            ),
            Effect.orDie
          ),
      pinnedSubject: (ownerUserId) =>
        db
          .select({ subject: worldApprovals.worldSubject })
          .from(worldApprovals)
          .where(
            and(
              eq(worldApprovals.ownerUserId, ownerUserId),
              eq(worldApprovals.status, "used"),
              isNotNull(worldApprovals.worldSubject)
            )
          )
          .orderBy(asc(worldApprovals.usedAt))
          .limit(1)
          .pipe(
            Effect.map(([row]) => row?.subject ?? null),
            Effect.orDie
          ),
      transition: (id, fromStatus, patch) =>
        db
          .update(worldApprovals)
          .set(patch)
          .where(
            and(
              eq(worldApprovals.id, id),
              eq(worldApprovals.status, fromStatus)
            )
          )
          .returning()
          .pipe(
            Effect.map(([row]) => row),
            Effect.orDie
          ),
    });
  })
);
