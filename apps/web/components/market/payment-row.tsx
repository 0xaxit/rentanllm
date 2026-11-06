import { GroupedRow } from "@/components/app-shell/grouped-list";
import { LocalTime } from "@/components/local-time";
import type { PaidRequest } from "@/lib/api/types";
import { HCS_AUDIT_TOPIC_ID } from "@/lib/env";
import {
  auditMessageUrl,
  networkLabel,
  paymentTxUrl,
  shortTx,
} from "@/lib/explorer";
import { formatInteger, formatUsdExact } from "@/lib/money";

/** One paid market request: model, output tokens, price and its on-chain payment. */
export const PaymentRow = ({ request }: { request: PaidRequest }) => {
  const url = paymentTxUrl(request.network, request.paymentTx);
  return (
    <GroupedRow
      detail={
        <>
          <LocalTime value={request.createdAt} /> ·{" "}
          {networkLabel(request.network)} ·{" "}
          {url === null ? (
            shortTx(request.paymentTx)
          ) : (
            <a
              className="text-amber underline"
              href={url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {shortTx(request.paymentTx)}
            </a>
          )}
          {request.auditSequence === null ? null : (
            <>
              {" · "}
              <a
                className="text-amber underline"
                href={auditMessageUrl(
                  HCS_AUDIT_TOPIC_ID,
                  request.auditSequence
                )}
                rel="noopener noreferrer"
                target="_blank"
              >
                log #{request.auditSequence}
              </a>
            </>
          )}
        </>
      }
      label={`${request.model} · ${formatInteger(request.outputTokens)} tokens out`}
      tone={request.status === "ok" ? "foam" : "muted"}
      value={formatUsdExact(request.paidUsdc)}
    />
  );
};
