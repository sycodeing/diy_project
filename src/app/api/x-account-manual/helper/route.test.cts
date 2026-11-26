/** In-memory API contract: no credentials, database, browser or X transport. */
const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
let database: any;
const load = Module._load;
Module._load = function (id: string, ...args: any[]) {
  if (id === "@/lib/x-account-manual-server") return { manualDb: () => database };
  if (id === "@/lib/x-reply-worker-auth") return { isAuthorizedXReplyWorker: () => true };
  return load.call(this, id, ...args);
};
const { POST } = require("./route.ts");
Module._load = load;
const boot = "11111111-1111-4111-8111-111111111111";
const id = "macbook-account-manual-01";
function memory(override: Record<string, unknown> = {}, requests: any[] = []) {
  const helper = { helper_id: id, boot_id: boot, status: "online", helper_version: "xuse-manual-read-v3",
    booted_at: new Date(Date.now() - 120000).toISOString(), last_seen_at: new Date(Date.now() - 61000).toISOString(),
    session_state: "idle", session_id: null, ...override };
  const db: any = { helper, requests, race: null, from(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    let patch: any = null;
    const q: any = {
      select() { return q; },
      eq(key: string, value: any) { filters.push(row => row[key] === value); return q; },
      is(key: string, value: any) { filters.push(row => row[key] === value); return q; },
      update(values: any) { patch = values; return q; },
      run() {
        if (!patch && table === "x_account_manual_helpers" && db.helperReadError) return { data: [], error: db.helperReadError };
        if (patch && table === "x_account_manual_helpers" && db.race) db.race();
        const rows = table === "x_account_manual_helpers" ? [helper] : requests;
        const found = rows.filter((row: any) => filters.every(fn => fn(row)));
        if (patch) for (const row of found) Object.assign(row, patch);
        return { data: found.map((row: any) => ({ ...row })), error: null };
      },
      maybeSingle() { const r = q.run(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      then(resolve: any, reject: any) { return Promise.resolve(q.run()).then(resolve, reject); },
    };
    return q;
  }};
  database = db;
  return db;
}
function heartbeat(extra: Record<string, unknown> = {}) {
  return POST(new Request("https://site.invalid/api/x-account-manual/helper", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "heartbeat", helperId: id,
      bootId: boot, capability: "xuse-manual-read-v3", sessionState: "idle", idleNeverStarted: true, ...extra }) }));
}
test("sleep >45s renews same idle boot and fences old pending requests before going online", async () => {
  const db = memory({}, [{ helper_id: id, boot_id: boot, status: "pending", claimed_at: null }]);
  assert.equal((await heartbeat()).status, 200);
  assert.equal(db.helper.boot_id, boot);
  assert.equal(db.helper.session_id, null);
  assert.equal(db.requests[0].status, "failed");
  assert.match(db.requests[0].message, /未自动重放/);
  assert.ok(Date.now() - Date.parse(db.helper.last_seen_at) < 1000);
});
test("retained, terminal and explicitly stopped states never revive from stale heartbeat", async () => {
  for (const state of [{ status: "stopped" }, { session_state: "open", session_id: "owned" },
    { session_state: "blocked" }, { session_state: "closed" }]) {
    const db = memory(state);
    const before = db.helper.last_seen_at;
    assert.equal((await heartbeat()).status, 409);
    assert.equal(db.helper.last_seen_at, before);
  }
});
test("claimed or uncertain history prevents idle renewal", async () => {
  for (const request of [{ status: "opening", claimed_at: "claimed" }, { status: "blocked" }, { status: "failed", claimed_at: "claimed" }]) {
    const db = memory({}, [{ helper_id: id, boot_id: boot, ...request }]);
    const before = db.helper.last_seen_at;
    assert.equal((await heartbeat()).status, 409);
    assert.equal(db.helper.last_seen_at, before);
  }
});
test("late heartbeat CAS cannot overwrite a concurrent explicit stop", async () => {
  const db = memory();
  db.race = () => { db.helper.status = "stopped"; };
  assert.equal((await heartbeat()).status, 409);
  assert.equal(db.helper.status, "stopped");
});
test("claim still requires freshness and old helpers cannot renew without never-started proof", async () => {
  memory();
  assert.equal((await heartbeat({ operation: "claim" })).status, 409);
  memory();
  assert.equal((await heartbeat({ idleNeverStarted: undefined })).status, 409);
});

test("transient helper read failure returns 503 without expiring the boot", async () => {
  const db = memory();
  db.helperReadError = { message: "offline simulated database failure" };
  assert.equal((await heartbeat()).status, 503);
  assert.equal(db.helper.status, "online");
});
