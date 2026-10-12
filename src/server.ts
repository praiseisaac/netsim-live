// The live exercise server: `npm start` (README.md has the options).
//
// A small HTTP server on 127.0.0.1 that serves one exercise (exercises.ts). Students open the link
// (on this computer, on your network with --lan, or through a tunnel), type a name and get a seat;
// the instructor runs the clock and the bus from /teach. "End and export" writes the session to
// ./exports/ (export.ts). It reads only its own files at start, and runs no other program.
//
// Who can do what:
//   - the instructor: a random token made at start and printed only here, in the terminal; /teach
//     and its API also answer only on this computer itself (never through a tunnel or the network)
//   - a student: the seat token handed out when they join, good for that seat only; their actions
//     and streams are rate-limited per seat (a whole class can share one campus address)
//   - everyone: a generous rate limit per client address, caps on seats and connections per
//     address and in all, on message sizes, and on how far a slow reader may fall behind
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as engine from "./engine";
import { EXERCISES } from "./exercises";
import { exportDir, exportName, exportRecord, indexEntry, renderIndex, renderReplay, type ExportRecord } from "./export";
import { glossaryDecorator } from "./glossary";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 4870;

const MAX_BODY = 2048;
/** Students' open streams in all, per seat, and per client address (instructor streams aside). */
const MAX_STREAMS = 150;
const MAX_STREAMS_PER_SEAT = 3;
const MAX_STREAMS_PER_IP = 100;
const MAX_TEACH_STREAMS = 8;
/** Seats one client address may hold (a class on one campus NAT is ~30). */
const MAX_SEATS_PER_IP = 45;
/** A stream whose unsent backlog passes this is a reader that stopped reading: it is cut off. */
const MAX_BACKLOG = 256 * 1024;
/** Views go out at most this often, however many changes there were. */
const BROADCAST_MS = 250;

/** The client's files, read once at start: nothing else is ever served. */
const STATIC: Record<string, { file: string; type: string; instructor?: boolean }> = {
  "/": { file: "student.html", type: "text/html; charset=utf-8" },
  "/teach": { file: "instructor.html", type: "text/html; charset=utf-8", instructor: true },
  "/live.css": { file: "live.css", type: "text/css; charset=utf-8" },
  "/common.js": { file: "common.js", type: "text/javascript; charset=utf-8" },
  "/student.js": { file: "student.js", type: "text/javascript; charset=utf-8" },
  "/instructor.js": { file: "instructor.js", type: "text/javascript; charset=utf-8", instructor: true },
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Constant-time: does `given` match `secret`? (Both hashed first, so lengths never leak.) */
export function sameSecret(given: string | undefined | null, secret: string): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Is this request from this computer itself, not through a tunnel or the network? It must come
 * from a loopback address (so not from another computer with --lan); and since a tunnel
 * (cloudflared) also connects from 127.0.0.1, it must also carry no proxy headers and name this
 * computer as its host, which a tunnelled request never does.
 */
export function isLocal(req: Pick<IncomingMessage, "headers"> & { socket?: { remoteAddress?: string } }, port: number): boolean {
  if (req.socket && !LOOPBACK.has(req.socket.remoteAddress ?? "")) return false;
  const h = req.headers;
  if (h["cf-connecting-ip"] || h["cf-ray"] || h["cf-visitor"] || h["x-forwarded-for"] || h["x-forwarded-host"] || h["forwarded"]) return false;
  return h.host === `127.0.0.1:${port}` || h.host === `localhost:${port}`;
}

/** A fixed-window rate limit: at most `max` hits per `windowMs` for each key. */
export class RateLimit {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  allow(key: string, now: number): boolean {
    const hit = this.hits.get(key);
    if (!hit || now >= hit.reset) {
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (now >= v.reset) this.hits.delete(k);
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    hit.count++;
    return hit.count <= this.max;
  }
}

export interface LiveOptions {
  exercise: engine.ExerciseDef;
  /** The folder the exports go into (each exercise's in its week-NN/ folder). */
  root: string;
  /** The students' link, shown on the instructor page and the empty in-class page. */
  liveUrl?: string;
  now?: () => number;
  token?: string;
  /** Adds the glossary popovers to the replay page. */
  decorate?: (html: string) => string;
  /** The client files, by name (defaults to src/public). */
  files?: Record<string, string>;
  log?: (line: string) => void;
}

type Stream = { res: ServerResponse; seat: string | null; ip: string };

export function createLive(options: LiveOptions) {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const token = options.token ?? randomBytes(24).toString("base64url");
  let liveUrl = options.liveUrl ?? "";
  const files = options.files ?? Object.fromEntries(Object.values(STATIC).map(({ file }) => [file, readFileSync(join(HERE, "public", file), "utf8")]));
  const session = engine.createSession(options.exercise);
  /** sha256(seat token) → seat id. */
  const seats = new Map<string, string>();
  /** seat id → the client address it joined from (for the per-address seat cap). */
  const seatIps = new Map<string, string>();
  const streams = new Set<Stream>();
  let locked = false;
  let exported: { json: string; html: string } | null = null;
  let port = 0;
  // Per client address: generous, since a whole class may come from one campus address.
  const joins = new RateLimit(120, 60_000);
  const requests = new RateLimit(600, 10_000);
  // Per seat: what a student does once they have one.
  const actions = new RateLimit(20, 10_000);
  const streamOpens = new RateLimit(10, 10_000);

  const clientKey = (req: IncomingMessage) => String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?").slice(0, 64);
  const seatFor = (req: IncomingMessage): string | null => {
    const given = req.headers["x-seat-token"];
    if (typeof given !== "string" || given.length > 100) return null;
    const seat = seats.get(digest(given).toString("hex"));
    return seat && engine.seatOf(session, seat) ? seat : null;
  };
  const instructorAllowed = (req: IncomingMessage) => isLocal(req, port) && sameSecret(typeof req.headers["x-teach-token"] === "string" ? req.headers["x-teach-token"] : null, token);

  const viewFor = (stream: Stream) => (stream.seat === null ? { ...engine.instructorView(session), locked, liveUrl, exported } : engine.studentView(session, stream.seat));
  /** Write to a stream, or cut it off if its reader has stopped reading (its backlog only grows). */
  function push(stream: Stream, chunk: string): void {
    if (stream.res.writableLength > MAX_BACKLOG) {
      streams.delete(stream);
      stream.res.destroy();
      return;
    }
    stream.res.write(chunk);
  }
  let timer: NodeJS.Timeout | null = null;
  let lastSent = 0;
  /** Send everyone their own view, at most once per BROADCAST_MS however many changes there were. */
  function broadcast(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      lastSent = Date.now();
      for (const stream of [...streams]) {
        const view = viewFor(stream);
        if (!view) {
          stream.res.end();
          streams.delete(stream);
          continue;
        }
        push(stream, `data: ${JSON.stringify(view)}\n\n`);
      }
    }, Math.max(0, lastSent + BROADCAST_MS - Date.now()));
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return null;
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return null;
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) return null;
    }
    try {
      const value: unknown = JSON.parse(body);
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  function openStream(req: IncomingMessage, res: ServerResponse, seat: string | null): void {
    const ip = clientKey(req);
    const open = [...streams];
    if (seat === null) {
      if (open.filter((s) => s.seat === null).length >= MAX_TEACH_STREAMS) return send(res, 429, { error: "The instructor page is open in too many tabs." });
    } else {
      const students = open.filter((s) => s.seat !== null);
      if (students.length >= MAX_STREAMS) return send(res, 503, { error: "Too many people connected." });
      if (students.filter((s) => s.seat === seat).length >= MAX_STREAMS_PER_SEAT) return send(res, 429, { error: "This seat is open in too many tabs." });
      if (students.filter((s) => s.ip === ip).length >= MAX_STREAMS_PER_IP) return send(res, 429, { error: "Too many connections from here." });
    }
    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" });
    const stream: Stream = { res, seat, ip };
    streams.add(stream);
    res.write(`retry: 2000\n\ndata: ${JSON.stringify(viewFor(stream))}\n\n`);
    const ping = setInterval(() => push(stream, ": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(ping);
      streams.delete(stream);
    });
  }

  /** Write the session out: the JSON, its replay page, and the week's index page. */
  function writeExport(): { json: string; html: string } {
    const rel = exportDir(session.exercise.week);
    const rootReal = realpathSync(options.root);
    const dir = resolve(rootReal, rel);
    if (!dir.startsWith(rootReal + sep)) throw new Error("export folder outside the exports folder");
    mkdirSync(dir, { recursive: true });
    if (realpathSync(dir) !== dir) throw new Error("export folder is a link");
    const record = exportRecord(session, now());
    const name = exportName(new Date(now()), readdirSync(dir));
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    writeFileSync(join(dir, `${name}.html`), renderReplay(record, options.decorate), { flag: "wx" });
    const entries = [];
    for (const file of readdirSync(dir)) {
      const match = /^(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.json$/.exec(file);
      if (!match) continue;
      try {
        entries.push(indexEntry(match[1], JSON.parse(readFileSync(join(dir, file), "utf8")) as ExportRecord));
      } catch {
        // not one of ours: leave it out of the index
      }
    }
    // Temp file then rename: the index is never half-written.
    const temp = join(dir, `.index-${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(temp, renderIndex(session.exercise.week, entries, liveUrl), { flag: "wx" });
    renameSync(temp, join(dir, "index.html"));
    return { json: `${rel}/${name}.json`, html: `${rel}/${name}.html` };
  }

  function teach(action: Record<string, unknown>): engine.Result<unknown> {
    const at = now();
    const seat = typeof action.seat === "string" ? action.seat : "";
    switch (action.type) {
      case "tick":
        return engine.tick(session, action.force === true, at);
      case "deliver":
      case "drop":
        return engine.decide(session, Number(action.seq), action.type === "deliver", at);
      case "assign":
        return engine.assign(session, seat, typeof action.role === "string" && action.role ? action.role : null, at);
      case "auto":
        return engine.autoAssign(session, at);
      case "reveal":
        return engine.reveal(session, String(action.role ?? ""), at);
      case "kick": {
        const result = engine.removeSeat(session, seat, at);
        if (result.ok) {
          for (const [hash, id] of seats) if (id === seat) seats.delete(hash);
          seatIps.delete(seat);
          for (const s of streams) if (s.seat === seat) s.res.end();
        }
        return result;
      }
      case "lock":
        locked = action.locked === true;
        return { ok: true, value: undefined };
      case "reset": {
        // Back to waiting for tick 1. Writes nothing: an earlier export stays as it was, and the
        // next End and export writes a new one beside it.
        const clear = action.clear === true;
        engine.restart(session, clear);
        exported = null;
        if (clear) {
          // Everyone's token stops working and their page asks them to join again.
          seats.clear();
          seatIps.clear();
          for (const s of [...streams]) {
            if (s.seat === null) continue;
            streams.delete(s);
            s.res.end();
          }
        }
        log(clear ? "reset: cleared everyone" : "reset: restarted the exercise");
        return { ok: true, value: undefined };
      }
      case "end": {
        if (session.phase !== "ended") {
          const ended = engine.end(session, at);
          if (!ended.ok) return ended;
        }
        if (exported) return { ok: true, value: exported };
        try {
          exported = writeExport();
          log(`exported: ${exported.html}`);
          return { ok: true, value: exported };
        } catch (error) {
          log(`export failed: ${error instanceof Error ? error.message : String(error)}`);
          return { ok: false, error: "The session ended, but the export couldn't be written. Check the terminal, then press End and export again." };
        }
      }
      default:
        return { ok: false, error: "Unknown action." };
    }
  }

  function student(seat: string, action: Record<string, unknown>): engine.Result<unknown> {
    const at = now();
    switch (action.type) {
      case "send":
        return engine.send(session, seat, { id: action.id, to: action.to, replyTo: action.replyTo, kind: action.kind, arg: action.arg, text: action.text }, at);
      case "done":
        return engine.done(session, seat, at);
      case "note":
        return engine.note(session, seat, action.text, at);
      default:
        return { ok: false, error: "Unknown action." };
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    // A student's own actions and stream are limited per seat below; everything else per address.
    const seatRoute = url.pathname === "/api/act" || url.pathname === "/api/stream";
    if (!(seatRoute && seatFor(req)) && !requests.allow(clientKey(req), now())) return send(res, 429, { error: "Slow down a little." });
    if (method === "POST") {
      // Same-origin only (a page elsewhere can't post here; the tokens in headers already mean it can't act).
      const origin = req.headers.origin;
      if (origin && origin !== `https://${req.headers.host}` && origin !== `http://${req.headers.host}`) return send(res, 403, { error: "Wrong origin." });
    }

    const file = STATIC[url.pathname];
    if (method === "GET" && file) {
      if (file.instructor && !isLocal(req, port)) return send(res, 404, { error: "Not found." });
      res.writeHead(200, { ...SECURITY_HEADERS, "content-type": file.type }).end(files[file.file]);
      return;
    }
    if (method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204, SECURITY_HEADERS).end();
      return;
    }

    if (url.pathname === "/api/join" && method === "POST") {
      if (!joins.allow(clientKey(req), now())) return send(res, 429, { error: "Too many joins from here. Wait a minute." });
      if (locked) return send(res, 403, { error: "The class is closed to new people right now." });
      const ip = clientKey(req);
      let fromHere = 0;
      for (const [id, at] of seatIps) if (at === ip && engine.seatOf(session, id)) fromHere++;
      if (fromHere >= MAX_SEATS_PER_IP) return send(res, 429, { error: "Too many people have joined from here." });
      const body = await readJson(req);
      if (!body) return send(res, 400, { error: "Bad request." });
      const seatId = randomBytes(9).toString("base64url");
      const joined = engine.join(session, seatId, body.name, now());
      if (!joined.ok) return send(res, 400, { error: joined.error });
      const seatToken = randomBytes(24).toString("base64url");
      seats.set(digest(seatToken).toString("hex"), seatId);
      seatIps.set(seatId, ip);
      log(`joined: ${joined.value.name}`);
      broadcast();
      return send(res, 200, { token: seatToken, name: joined.value.name });
    }
    if (url.pathname === "/api/stream" && method === "GET") {
      const seat = seatFor(req);
      if (!seat) return send(res, 401, { error: "Join first." });
      if (!streamOpens.allow(seat, now())) return send(res, 429, { error: "Slow down a little." });
      return openStream(req, res, seat);
    }
    if (url.pathname === "/api/act" && method === "POST") {
      const seat = seatFor(req);
      if (!seat) return send(res, 401, { error: "Join first." });
      if (!actions.allow(seat, now())) return send(res, 429, { error: "Slow down a little." });
      const body = await readJson(req);
      if (!body) return send(res, 400, { error: "Bad request." });
      const result = student(seat, body);
      if (result.ok) broadcast();
      return send(res, result.ok ? 200 : 400, result.ok ? { ok: true } : { error: result.error });
    }
    if (url.pathname === "/api/teach/stream" && method === "GET") {
      if (!instructorAllowed(req)) return send(res, 404, { error: "Not found." });
      return openStream(req, res, null);
    }
    if (url.pathname === "/api/teach/act" && method === "POST") {
      if (!instructorAllowed(req)) return send(res, 404, { error: "Not found." });
      const body = await readJson(req);
      if (!body) return send(res, 400, { error: "Bad request." });
      const result = teach(body);
      broadcast();
      return send(res, result.ok ? 200 : 400, result.ok ? { ok: true, value: result.value ?? null } : { error: result.error });
    }
    send(res, 404, { error: "Not found." });
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(`error: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) send(res, 500, { error: "Something went wrong." });
      else res.end();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxHeadersCount = 50;
  server.maxConnections = 400;

  return {
    server,
    token,
    session,
    /** The students' link, once the port is known. */
    setLiveUrl(url: string): void {
      liveUrl = url;
    },
    /** Listen on 127.0.0.1 (a tunnel connects locally), or on every address for --lan. */
    listen(onPort = DEFAULT_PORT, host: "127.0.0.1" | "0.0.0.0" = "127.0.0.1"): Promise<number> {
      return new Promise((done, fail) => {
        server.once("error", fail);
        server.listen(onPort, host, () => {
          const address = server.address();
          port = typeof address === "object" && address ? address.port : onPort;
          done(port);
        });
      });
    },
    close(): Promise<void> {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const s of streams) s.res.end();
      streams.clear();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

/** This computer's address on the local network, for --lan. */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  if (args.includes("--help")) {
    console.log("npm start -- [--port 4870] [--exercise <id>] [--out ./exports] [--lan] [--public-url https://…/] [--link-file <path>]");
    console.log(`exercises: ${Object.keys(EXERCISES).join(", ")}`);
    return;
  }
  const exerciseId = value("--exercise") ?? Object.keys(EXERCISES)[0];
  const exercise = EXERCISES[exerciseId];
  if (!exercise) throw new Error(`No exercise ${exerciseId}. There are: ${Object.keys(EXERCISES).join(", ")}`);
  const root = resolve(value("--out") ?? "exports");
  mkdirSync(root, { recursive: true });
  const port = Number(value("--port") ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a port number");
  const lan = args.includes("--lan");
  const lanIp = lan ? lanAddress() : null;
  if (lan && !lanIp) throw new Error("--lan: this computer isn't on a network");
  const linkFile = value("--link-file");
  const live = createLive({ exercise, root, liveUrl: "", decorate: glossaryDecorator(), log: (line) => console.log(`[live] ${line}`) });
  const bound = await live.listen(port, lan ? "0.0.0.0" : "127.0.0.1");
  const local = `http://127.0.0.1:${bound}/`;
  const studentUrl = value("--public-url") ?? (lanIp ? `http://${lanIp}:${bound}/` : local);
  live.setLiveUrl(studentUrl);
  const teachUrl = `http://127.0.0.1:${bound}/teach#t=${live.token}`;
  if (linkFile) writeFileSync(linkFile, `${teachUrl}\n`, { mode: 0o600, flag: "wx" });
  console.log(`[live] ${exercise.title} (week ${exercise.week})`);
  console.log(`[live] students: ${studentUrl}${studentUrl === local ? "" : `  (on this computer: ${local})`}`);
  console.log(`[live] you, the bus and the clock (this computer only; keep it to yourself): ${teachUrl}`);
  console.log(`[live] exports go to ${join(root, exportDir(exercise.week))}/`);
  if (lan) console.log("[live] --lan: anyone on your network can open the students' link. Stop it (Ctrl-C) when you're done.");
  const stop = () => {
    live.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
