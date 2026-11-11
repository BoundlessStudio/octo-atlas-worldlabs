// Operations & assets — the audit trail. Every task left an operation whose exact
// request/response can be replayed with :trace, and every output is a project asset.
import { api, getState, wl, log } from "../lib/atlas.mjs";

export default async function audit() {
  const { operations = [] } = await api("GET", "/operations?pageSize=25&origin=DEVELOPER_API").catch(() => api("GET", "/operations?pageSize=25"));
  const first = getState()["01-text-to-image"];
  const trace = first?.operationId ? await api("GET", `/operations/${first.operationId}:trace`).catch(() => null) : null;
  const assets = await wl.assets.list({ pageSize: 100 });
  log("09-audit", `${operations.length} recent operations, ${assets.assets?.length ?? 0}+ assets in the project`);
  return {
    recentOperations: operations.map((op) => ({ id: op.id, task: op.metadata?.task, state: op.metadata?.state, createdAtSecs: op.createdAtSecs })),
    trace: trace && { operationId: trace.operationId, taskName: trace.taskName, taskVersion: trace.taskVersion, request: trace.request },
    assetCount: assets.assets?.length ?? 0,
    assetsHaveMore: Boolean(assets.nextPageToken),
  };
}
