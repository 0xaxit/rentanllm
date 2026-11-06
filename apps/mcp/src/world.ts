/**
 * World ID Agent Pass approvals, as the MCP server uses them (approval mode "world").
 *
 * The RentAnLLM API holds World's client secret and validates World's ID token; this
 * server only ever sees the approval's state. A payment above the threshold is signed
 * only after the API has *consumed* an approval for exactly that amount and payee.
 *
 * The first person to approve is pinned as this payer's person (`world-subject` in the
 * state dir); from then on World is asked for that person and the API refuses anyone else.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type WorldStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled"
  | "failed"
  | "used";

export interface WorldApproval {
  readonly expiresAt: Date;
  readonly failureReason: string | null;
  readonly id: string;
  readonly status: WorldStatus;
  readonly userCode: string;
  /** Where the person approves: World's page, with the code filled in when World gives one. */
  readonly link: string;
  readonly worldSubject: string | null;
}

/** The API could not be reached or refused the call. Nothing was approved. */
export class WorldApprovalError extends Error {
  override readonly name = "WorldApprovalError";
}

const SUBJECT_FILE = "world-subject";

interface ApprovalJson {
  readonly expiresAt: string;
  readonly failureReason: string | null;
  readonly id: string;
  readonly status: WorldStatus;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string | null;
  readonly worldSubject: string | null;
}

const toApproval = (body: ApprovalJson): WorldApproval => ({
  expiresAt: new Date(body.expiresAt),
  failureReason: body.failureReason,
  id: body.id,
  link: body.verificationUriComplete ?? body.verificationUri,
  status: body.status,
  userCode: body.userCode,
  worldSubject: body.worldSubject,
});

const call = async (
  apiUrl: string,
  route: string,
  body: Record<string, unknown>
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/approvals${route}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    throw new WorldApprovalError(
      `the RentAnLLM API is not reachable at ${apiUrl}: ${String(error)}`
    );
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json === "object" &&
      json !== null &&
      "message" in json &&
      typeof json.message === "string"
        ? json.message
        : `HTTP ${response.status}`;
    throw new WorldApprovalError(message);
  }
  return json;
};

export interface WorldClient {
  readonly cancel: (id: string, secret: string) => Promise<WorldApproval>;
  readonly check: (id: string, secret: string) => Promise<WorldApproval>;
  /** Uses an approved approval for exactly this payment. Throws if it is not approved. */
  readonly consume: (
    id: string,
    secret: string,
    amountMicros: bigint,
    payTo: string
  ) => Promise<WorldApproval>;
  readonly create: (input: {
    readonly amountMicros: bigint;
    readonly description: string;
    readonly network: string;
    readonly payTo: string;
    readonly payer: string;
  }) => Promise<{ readonly approval: WorldApproval; readonly secret: string }>;
}

export const worldClient = (apiUrl: string, stateDir: string): WorldClient => {
  const subjectPath = path.join(stateDir, SUBJECT_FILE);
  const pinnedSubject = (): string | null => {
    try {
      const subject = readFileSync(subjectPath, "utf-8").trim();
      return subject.length > 0 ? subject : null;
    } catch {
      return null;
    }
  };

  return {
    cancel: async (id, secret) =>
      toApproval(
        (await call(apiUrl, `/${id}/cancel`, { secret })) as ApprovalJson
      ),
    check: async (id, secret) =>
      toApproval(
        (await call(apiUrl, `/${id}/check`, { secret })) as ApprovalJson
      ),
    consume: async (id, secret, amountMicros, payTo) => {
      const used = toApproval(
        (await call(apiUrl, `/${id}/consume`, {
          amountUsdc: amountMicros.toString(),
          payTo,
          secret,
        })) as ApprovalJson
      );
      if (used.status !== "used") {
        throw new WorldApprovalError(
          `approval ${id} is ${used.status}, not used`
        );
      }
      if (used.worldSubject !== null && pinnedSubject() === null) {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(subjectPath, `${used.worldSubject}\n`, { mode: 0o600 });
      }
      return used;
    },
    create: async (input) => {
      const subject = pinnedSubject();
      const body = (await call(apiUrl, "", {
        amountUsdc: input.amountMicros.toString(),
        description: input.description,
        network: input.network,
        payTo: input.payTo,
        payer: input.payer,
        ...(subject === null ? {} : { expectedSubject: subject }),
      })) as { approval: ApprovalJson; secret: string };
      return { approval: toApproval(body.approval), secret: body.secret };
    },
  };
};
