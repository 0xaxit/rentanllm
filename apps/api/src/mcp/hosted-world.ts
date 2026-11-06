/**
 * The API side of World ID approval for the hosted connector (see world-gate.ts): the
 * user's threshold from their Budget limits, and approvals owned by the signed-in user.
 */
import { Db } from "@rentanllm/db";
import { buyerPolicies } from "@rentanllm/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Context } from "effect";

import { ApiConfig } from "../config";
import {
  cancelApproval,
  checkApproval,
  consumeApproval,
  createApproval,
} from "../services/approvals";
import type { ApprovalStore } from "../world/approval-store";
import type { WorldIdpService } from "../world/world-idp-service";
import { HostedWorldError } from "./world-gate";
import type { HostedWorld } from "./world-gate";

const NETWORK = "hedera:testnet";

type Services = Db | ApprovalStore | WorldIdpService;

/** Runs `effect` and turns its expected failures into a HostedWorldError with their message. */
const runner =
  (services: Context.Context<Services>) =>
  async <A, E extends { readonly message: string }>(
    effect: Effect.Effect<A, E, Services>
  ): Promise<A> => {
    const outcome = await Effect.runPromise(
      effect.pipe(
        Effect.match({
          onFailure: (error) => ({ error, ok: false as const }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
        Effect.provideContext(services)
      )
    );
    if (!outcome.ok) {
      throw new HostedWorldError(outcome.error.message);
    }
    return outcome.value;
  };

/** World ID approvals for `userId`'s payments; null when the API has no World ID. */
export const hostedWorld = Effect.fn("mcp.hostedWorld")(
  function* hostedWorldGen(userId: string) {
    const config = yield* ApiConfig;
    if (config.world === undefined) {
      return null;
    }
    const run = runner(yield* Effect.context<Services>());
    const owner = { ownerUserId: userId };
    return {
      approvalAbove: () =>
        run(
          Effect.gen(function* approvalAboveGen() {
            const db = yield* Db;
            const [row] = yield* db
              .select({ above: buyerPolicies.worldApprovalAboveMicros })
              .from(buyerPolicies)
              .where(eq(buyerPolicies.userId, userId));
            return row?.above ?? null;
          }).pipe(Effect.orDie)
        ),
      cancel: async (approvalId) => {
        await run(cancelApproval(approvalId, owner));
        return `Cancelled payment ${approvalId}. Nothing was paid.`;
      },
      hold: async (input) => {
        const { approval } = await run(
          createApproval({
            amountUsdc: input.amountMicros,
            description: input.description,
            network: NETWORK,
            ownerUserId: userId,
            payTo: input.payTo,
            payer: input.payer,
          })
        );
        return {
          expiresAt: approval.expiresAt,
          id: approval.id,
          link: approval.verificationUriComplete ?? approval.verificationUri,
          userCode: approval.userCode,
        };
      },
      settle: async (input) => {
        const approval = await run(checkApproval(input.approvalId, owner));
        if (approval.status === "pending") {
          return { kind: "pending" };
        }
        if (approval.status !== "approved") {
          const why =
            approval.failureReason === null
              ? ""
              : `: ${approval.failureReason}`;
          return {
            kind: "refused",
            reason: `the World ID approval was ${approval.status}${why}`,
          };
        }
        try {
          await run(
            consumeApproval(input.approvalId, {
              amountUsdc: input.amountMicros,
              credential: owner,
              payTo: input.payTo,
            })
          );
        } catch (error) {
          return {
            kind: "refused",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        return { kind: "approved" };
      },
    } satisfies HostedWorld;
  }
);
