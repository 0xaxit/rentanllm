import type { ApiNode, NodeUptime } from "@/lib/api/types";

import { GroupedList, GroupedRow } from "../app-shell/grouped-list";
import { LocalTime } from "../local-time";
import { NodeUptimeRows, UptimeStrip } from "./node-uptime";

/** Heartbeat, uptime, agent and region; a node that never connected has only its id. */
export const NodeDetails = ({
  node,
  uptime,
}: {
  node: ApiNode;
  uptime: NodeUptime | null;
}) => (
  <>
    <GroupedList title="AGENT">
      {node.connectedAt !== null && (
        <>
          <GroupedRow
            label="Last heartbeat"
            value={
              node.lastHeartbeatAt ? (
                <LocalTime value={node.lastHeartbeatAt} />
              ) : (
                "never"
              )
            }
          />
          {uptime && <NodeUptimeRows uptime={uptime} />}
          <GroupedRow label="Agent" value={node.version ?? "—"} />
          <GroupedRow label="Region" value={node.region ?? "—"} />
        </>
      )}
      <GroupedRow
        label="Node id"
        value={<span className="break-all">{node.id}</span>}
      />
    </GroupedList>
    {uptime?.trackedSince && <UptimeStrip uptime={uptime} />}
  </>
);
