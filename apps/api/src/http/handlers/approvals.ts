import { RentAnLlmApi } from "@rentanllm/api-contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import {
  cancelApproval,
  checkApproval,
  consumeApproval,
  createApproval,
} from "../../services/approvals";
import type { ApprovalStore } from "../../world/approval-store";
import type { WorldIdpService } from "../../world/world-idp-service";
import { captureServices } from "../app-services";

/** World ID payment approvals. The approval's secret authorizes every call after create. */
export const ApprovalsHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "approvals",
  Effect.fn(function* approvalsHandlers(handlers) {
    const provide = yield* captureServices<ApprovalStore | WorldIdpService>();
    return handlers
      .handle("create", ({ payload }) => provide(createApproval(payload)))
      .handle("check", ({ params, payload }) =>
        provide(checkApproval(params.approvalId, { secret: payload.secret }))
      )
      .handle("consume", ({ params, payload }) =>
        provide(
          consumeApproval(params.approvalId, {
            amountUsdc: payload.amountUsdc,
            credential: { secret: payload.secret },
            payTo: payload.payTo,
          })
        )
      )
      .handle("cancel", ({ params, payload }) =>
        provide(cancelApproval(params.approvalId, { secret: payload.secret }))
      );
  })
);
