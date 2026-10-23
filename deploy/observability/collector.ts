import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redactSecrets } from "../../server/redact.ts";
import type { Assignment } from "../../server/runtime/types.ts";
import type { WireMessage } from "../../shared/wire.ts";

const PAGE = 500;
const SOURCE_LIMIT = 256 * 1024;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
type Row = Record<string, any>;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const text = (value: string | undefined) => value?.slice(0, 6000);

function messageSnapshot(message: WireMessage) {
  const { id, at, role, kind, parentId, requestMessageId, turnId, turnTerminal, turnSucceeded,
    requestPending, requestCancelled, from, peerAsk, peerPost, relayed, via, steered, roomRequest,
    routedBy, channelMode, goalRun, routineRun, digest, quickModel } = message;
  return redactSecrets({ id, at, role, kind, parentId, requestMessageId, turnId, turnTerminal,
    turnSucceeded, requestPending, requestCancelled, from, peerAsk, peerPost, relayed, via, steered,
    roomRequest, routedBy, channelMode, goalRun, routineRun, digest, quickModel,
    text: ["secret", "signin", "screen", "widget"].includes(kind) ? undefined : text(message.text),
    textTruncated: (message.text?.length ?? 0) > 6000,
    tool: message.tool && { ...message.tool, input: text(message.tool.input), output: text(message.tool.output) },
    toolPreviewTruncated: (message.tool?.input?.length ?? 0) > 6000 || (message.tool?.output?.length ?? 0) > 6000,
    card: message.card && { requestId: message.card.requestId, requestType: message.card.requestType,
      answered: message.card.answered, answeredBy: message.card.answeredBy, dismissed: message.card.dismissed,
      expired: message.card.expired, held: message.card.held, tool: message.card.tool },
  });
}

function sourceDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000");
  return db;
}

function stateDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 2000;
    PRAGMA max_page_count = 131072;
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (
      source TEXT NOT NULL, key TEXT NOT NULL, thread_id TEXT, root_id TEXT, at INTEGER,
      hash TEXT NOT NULL, json TEXT NOT NULL, observed_at INTEGER NOT NULL,
      PRIMARY KEY(source, key)
    );
    CREATE INDEX IF NOT EXISTS snapshots_thread ON snapshots(source, thread_id, at);
    CREATE INDEX IF NOT EXISTS snapshots_root ON snapshots(source, root_id, at);
    CREATE TABLE IF NOT EXISTS revisions (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, key TEXT NOT NULL,
      observed_at INTEGER NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_events (
      id INTEGER PRIMARY KEY, assignment_id TEXT NOT NULL, at INTEGER NOT NULL,
      kind TEXT NOT NULL, detail TEXT, observed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runtime_events_assignment ON runtime_events(assignment_id, id);
    CREATE TABLE IF NOT EXISTS collection_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, detail TEXT NOT NULL
    );
  `);
  return db;
}

export class Collector {
  readonly state: DatabaseSync;
  private runtime?: DatabaseSync;
  private messages?: DatabaseSync;
  private readonly sourceDir: string;
  private readonly now: () => number;

  constructor(sourceDir: string, stateFile: string, now = Date.now) {
    this.sourceDir = sourceDir;
    this.now = now;
    this.state = stateDatabase(stateFile);
    if (!this.get("startedAt")) this.set("startedAt", this.now());
  }

  private get(key: string): any {
    const row = this.state.prepare("SELECT value FROM state WHERE key = ?").get(key);
    return row ? JSON.parse(String(row.value)) : undefined;
  }

  private set(key: string, value: unknown) {
    this.state.prepare("INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  private snapshot(source: string, key: string, value: any, threadId?: string, rootId?: string, at?: number) {
    const json = JSON.stringify(redactSecrets(value));
    const digest = hash(json);
    const previous = this.state.prepare("SELECT hash FROM snapshots WHERE source = ? AND key = ?").get(source, key);
    if (previous?.hash === digest) return;
    const observedAt = this.now();
    this.state.prepare(`INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, key) DO UPDATE SET thread_id = excluded.thread_id, root_id = excluded.root_id,
      at = excluded.at, hash = excluded.hash, json = excluded.json, observed_at = excluded.observed_at`)
      .run(source, key, threadId ?? null, rootId ?? null, at ?? null, digest, json, observedAt);
    this.state.prepare("INSERT INTO revisions(source, key, observed_at, hash, json) VALUES (?, ?, ?, ?, ?)")
      .run(source, key, observedAt, digest, json);
  }

  private captureAssignment(row: Row) {
    const a = JSON.parse(row.json) as Assignment;
    this.snapshot("assignment", a.id, a, a.assignee.destination.threadId, a.rootId, a.createdAt);
  }

  private captureMessage(row: Row) {
    const key = `${row.thread_id}:${row.id}`;
    if (row.json.length > SOURCE_LIMIT) {
      this.snapshot("message", key, { id: row.id, at: row.at, role: row.role, kind: row.kind,
        captureGap: "Source message exceeds the 256K character read limit; inspect its original transcript." }, row.thread_id, undefined, row.at);
      return;
    }
    this.snapshot("message", key, messageSnapshot(JSON.parse(row.json)), row.thread_id, undefined, row.at);
  }

  private collectRows(db: DatabaseSync, table: "messages" | "assignments", refresh = false) {
    const cursorKey = `${table}.${refresh ? "refresh" : "cursor"}`;
    const cursor = this.get(cursorKey) ?? 0;
    const columns = table === "messages"
      ? "rowid AS position, thread_id, id, at, role, kind, substr(json, 1, 262145) AS json"
      : "rowid AS position, id, json";
    const rows = db.prepare(`SELECT ${columns} FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`).all(cursor, PAGE) as Row[];
    for (const row of rows) {
      if (table === "messages") this.captureMessage(row);
      else this.captureAssignment(row);
    }
    if (refresh && rows.length < PAGE) {
      this.set(cursorKey, 0);
      this.set(`${table}.refreshCompletedAt`, this.now());
    } else if (rows.length) this.set(cursorKey, rows.at(-1)!.position);
    const max = Number(db.prepare(`SELECT MAX(rowid) AS position FROM ${table}`).get()?.position ?? 0);
    if (!refresh) {
      if (max < cursor) throw new Error(`${table}: source row identities moved backwards; source replacement requires review`);
      this.set(`${table}.caughtUp`, (rows.at(-1)?.position ?? cursor) >= max);
    }
  }

  private profiles() {
    for (const [file, source] of [["bots.json", "bot"], ["groups.json", "group"]] as const) {
      const parsed = JSON.parse(readFileSync(join(this.sourceDir, file), "utf8"));
      const rows = Array.isArray(parsed) ? parsed : parsed[`${source}s`];
      if (!Array.isArray(rows)) throw new Error(`${file}: unrecognized metadata format`);
      for (const row of rows) {
        const value = source === "bot"
          ? { id: row.id, name: row.name, title: row.title, modelSelection: row.modelSelection,
            soulHash: hash(row.soul ?? ""), section: row.section, chiefOfStaff: row.chiefOfStaff }
          : { id: row.id, name: row.name, memberIds: row.memberIds, defaultResponder: row.defaultResponder };
        this.snapshot(source, row.id, value);
      }
    }
  }

  collect(): { ok: boolean; error?: string } {
    const start = this.now();
    try {
      this.runtime ??= sourceDatabase(join(this.sourceDir, "runtime.db"));
      this.messages ??= sourceDatabase(join(this.sourceDir, "messages.db"));
      this.state.exec("BEGIN IMMEDIATE");
      for (const name of ["runtime", "messages"]) {
        const inode = statSync(join(this.sourceDir, `${name}.db`)).ino;
        const previous = this.get(`${name}.inode`);
        if (previous !== undefined && previous !== inode) throw new Error(`${name}: source database was replaced; review before resetting observation state`);
        this.set(`${name}.inode`, inode);
      }
      const cursor = this.get("events.cursor") ?? 0;
      const events = this.runtime.prepare("SELECT * FROM assignment_events WHERE id > ? ORDER BY id LIMIT ?").all(cursor, PAGE) as Row[];
      const changed = new Set<string>();
      for (const e of events) {
        this.state.prepare("INSERT OR IGNORE INTO runtime_events VALUES (?, ?, ?, ?, ?, ?)")
          .run(e.id, e.assignment_id, e.at, e.kind, e.detail ? String(redactSecrets(e.detail)) : null, this.now());
        changed.add(e.assignment_id);
      }
      for (const id of changed) {
        const row = this.runtime.prepare("SELECT json FROM assignments WHERE id = ?").get(id);
        if (row) this.captureAssignment(row);
      }
      const high = Number(this.runtime.prepare("SELECT MAX(id) AS id FROM assignment_events").get()?.id ?? 0);
      if (high < cursor) throw new Error("runtime events moved backwards; source replacement requires review");
      this.set("events.cursor", events.at(-1)?.id ?? cursor);
      this.set("events.caughtUp", (events.at(-1)?.id ?? cursor) >= high);
      this.collectRows(this.runtime, "assignments");
      this.collectRows(this.messages, "messages");
      this.collectRows(this.runtime, "assignments", true);
      this.collectRows(this.messages, "messages", true);
      for (const row of this.messages.prepare(`SELECT thread_id, id, at, role, kind, substr(json, 1, 262145) AS json
        FROM messages ORDER BY rowid DESC LIMIT ?`).all(PAGE) as Row[]) this.captureMessage(row);
      this.profiles();
      this.set("lastSuccessAt", this.now());
      this.set("lastDurationMs", this.now() - start);
      this.set("lastError", null);
      this.state.exec("COMMIT");
      return { ok: true };
    } catch (error) {
      try { this.state.exec("ROLLBACK"); } catch {}
      const detail = String(redactSecrets(error instanceof Error ? error.message : String(error))).slice(0, 1000);
      this.set("lastError", { at: this.now(), detail });
      this.state.prepare("INSERT INTO collection_errors(at, detail) VALUES (?, ?)").run(this.now(), detail);
      this.runtime?.close(); this.runtime = undefined;
      this.messages?.close(); this.messages = undefined;
      return { ok: false, error: detail };
    }
  }

  close() {
    this.runtime?.close();
    this.messages?.close();
    this.state.close();
  }
}

export function health(db: DatabaseSync, now = Date.now()): Record<string, any> & { ok: boolean } {
  const values = Object.fromEntries(db.prepare("SELECT key, value FROM state").all().map(row => [String(row.key), JSON.parse(String(row.value))]));
  return { ok: Boolean(values.lastSuccessAt && !values.lastError && now - values.lastSuccessAt < 120_000),
    ...values, snapshotCount: db.prepare("SELECT count(*) AS n FROM snapshots").get()!.n,
    eventCount: db.prepare("SELECT count(*) AS n FROM runtime_events").get()!.n };
}

export function report(db: DatabaseSync, filter: { rootId?: string; threadId?: string; limit?: number } = {}, now = Date.now()) {
  if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 500)) {
    throw new Error("limit must be an integer from 1 to 500");
  }
  const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
  const where = filter.rootId ? "AND root_id = ?" : filter.threadId ? "AND thread_id = ?" : "";
  const args = filter.rootId ? [filter.rootId] : filter.threadId ? [filter.threadId] : [];
  const roots = db.prepare(`SELECT DISTINCT root_id, MAX(at) AS at FROM snapshots WHERE source = 'assignment' ${where}
    GROUP BY root_id ORDER BY at DESC LIMIT ?`).all(...args, limit + 1) as Row[];
  const runs = roots.slice(0, limit).map(({ root_id: rootId }) => {
    const rows = db.prepare("SELECT json, observed_at FROM snapshots WHERE source = 'assignment' AND root_id = ? ORDER BY at").all(rootId);
    const assignments = rows.map(r => ({ a: JSON.parse(String(r.json)) as Assignment, observedAt: Number(r.observed_at) }));
    const nodes = assignments.map(({ a, observedAt }) => {
      const events = db.prepare("SELECT * FROM runtime_events WHERE assignment_id = ? ORDER BY id").all(a.id);
      return { id: a.id, parentId: a.parentId, botId: a.assignee.botId, threadId: a.assignee.destination.threadId,
        groupId: a.assignee.destination.groupId, origin: a.origin, requester: a.requester,
        mode: a.mode, executionStatus: a.status, executionOutcome: a.outcome, outcomeDetail: a.outcomeDetail,
        requestedContribution: a.brief, requestedAcceptance: a.doneWhen, agentClaim: a.result,
        harnessEvidence: a.evidence ?? null, createdAt: a.createdAt, startedAt: a.startedAt, finishedAt: a.finishedAt,
        elapsedMs: (a.finishedAt ?? now) - a.createdAt, queueMs: a.startedAt ? a.startedAt - a.createdAt : null,
        msSinceRuntimeProgress: now - a.lastActivityAt, executions: a.executions, restarts: a.restarts,
        waitingOnPerson: a.status === "needs_input", waitingFor: a.continuation?.waitFor ?? null, observedAt, events,
        reviewSignals: [
          ...(!a.startedAt ? ["no_recorded_start"] : []),
          ...(!TERMINAL.has(a.status) && now - a.lastActivityAt > 30 * 60_000 ? ["no_runtime_progress_for_30_minutes"] : []),
          ...(a.mode === "work" && a.status === "completed" && !a.evidence?.toolCalls ? ["completed_without_recorded_tool_calls"] : []),
          ...(!a.evidence ? ["turn_evidence_unavailable"] : []),
        ] };
    });
    const root = assignments.find(({ a }) => a.id === rootId)?.a;
    return { rootId, runtimeBrief: root?.brief ?? null, userQuote: root?.origin.quote ?? null, goalRunId: root?.goalRunId,
      businessOutcome: "unverified", voluntaryOwnership: "not_established_by_runtime_assignments",
      cycle: { objective: root ? "runtime_brief_captured" : "root_record_missing",
        steps: "plan_not_structured_delegation_records_available", execution: "runtime_events",
        stepVerification: "unverified", objectiveVerification: "unverified",
        escalation: "routing_captured_role_hierarchy_not_configured" },
      nodes, delegatedNodes: nodes.filter(n => n.parentId).length,
      answerEvents: nodes.reduce((n, a) => n + a.events.filter(e => e.kind === "answered").length, 0) };
  });
  const context = filter.threadId ? db.prepare(`SELECT key, json, observed_at FROM snapshots
    WHERE source = 'message' AND thread_id = ? ORDER BY at DESC LIMIT ?`).all(filter.threadId, limit + 1) : [];
  return { generatedAt: now, collection: health(db, now), runs, moreRuns: roots.length > limit,
    threadContext: context.slice(0, limit).reverse().map(r => ({ source: `messages:${r.key}`, observedAt: r.observed_at, message: JSON.parse(String(r.json)) })),
    moreThreadContext: context.length > limit,
    limitations: [
      "Execution completion and successful tool calls do not establish the business outcome.",
      "A runtime root may be a question, routine or intermediate turn; it is not automatically a business objective.",
      "Assignments prove dispatch, not voluntary ownership or correct delegation. Review the original conversations.",
      "Runtime events retain source timestamps; message/profile revisions are sampled snapshots with observedAt timestamps.",
      "Thread context is not automatically attributed to a runtime root. requestMessageId is the server's message provenance when present.",
      "Older evidence already pruned by the application cannot be recovered. No external outcome readback is performed by this collector.",
    ] };
}
