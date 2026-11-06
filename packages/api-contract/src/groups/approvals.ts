import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { Conflict } from "../errors/conflict";
import { InvalidRequest } from "../errors/invalid-request";
import { NotFound } from "../errors/not-found";
import { Unavailable } from "../errors/unavailable";
import {
  ApprovalSchema,
  ApprovalSecretRequestSchema,
  ConsumeApprovalRequestSchema,
  CreateApprovalRequestSchema,
  CreateApprovalResponseSchema,
  UuidSchema,
} from "../schemas";

const created = HttpApiSchema.status(201);

/**
 * Human approval of one agent payment through World ID Agent Pass. The agent creates an
 * approval, shows the person World's link, then checks it; the backend validates World's
 * ID token. A payment is released only by `consume`, once, for the exact amount and payee.
 * Every call after create needs the approval's `secret`.
 */
export class ApprovalsGroup extends HttpApiGroup.make("approvals")
  .add(
    HttpApiEndpoint.post("create", "/", {
      error: [InvalidRequest, Unavailable],
      payload: CreateApprovalRequestSchema,
      success: created(CreateApprovalResponseSchema),
    }),
    /** Polls World once (at most every interval) and returns the approval's state. */
    HttpApiEndpoint.post("check", "/:approvalId/check", {
      error: [NotFound, Unavailable],
      params: { approvalId: UuidSchema },
      payload: ApprovalSecretRequestSchema,
      success: ApprovalSchema,
    }),
    HttpApiEndpoint.post("consume", "/:approvalId/consume", {
      error: [NotFound, Conflict, Unavailable],
      params: { approvalId: UuidSchema },
      payload: ConsumeApprovalRequestSchema,
      success: ApprovalSchema,
    }),
    HttpApiEndpoint.post("cancel", "/:approvalId/cancel", {
      error: [NotFound, Conflict],
      params: { approvalId: UuidSchema },
      payload: ApprovalSecretRequestSchema,
      success: ApprovalSchema,
    })
  )
  .prefix("/approvals") {}
