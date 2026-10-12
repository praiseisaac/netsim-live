// The live in-class server (src/server.ts) over real HTTP on 127.0.0.1: who may do what,
// the caps, and End and export writing only into the exports folder.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WEEK_02_ACT_IT_OUT } from "../src/exercises";
import { createLive, isLocal, RateLimit, sameSecret } from "../src/server";

const FILES = Object.fromEntries(["student.html", "instructor.html", "live.css", "common.js", "student.js", "instructor.js"].map((f) => [f, `/* ${f} */`]));

let live: ReturnType<typeof createLive>;
let port = 0;
let root = "";
const clock = Date.UTC(2026, 9, 12, 18, 0, 0);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "netsim-live-"));
  live = createLive({ exercise: WEEK_02_ACT_IT_OUT, root, files: FILES, now: () => clock, token: "teach-secret" });
  port = await live.listen(0);
});
afterEach(async () => {
  await live.close();
  rmSync(root, { recursive: true, force: true });
});

type Res = { status: number; body: string; headers: Record<string, string | string[] | undefined> };

function call(method: string, path: string, { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(
      { host: "127.0.0.1", port, method, path, headers: { ...(data !== undefined ? { "content-type": "application/json" } : {}), ...headers } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/** The first view a stream sends, then close it. */
function firstView(path: string, headers: Record<string, string>): Promise<{ status: number; view: Record<string, unknown> | null }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ status: res.statusCode ?? 0, view: null });
        return;
      }
      let text = "";
      res.on("data", (c) => {
        text += c;
        const m = /data: (.*)\n\n/.exec(text);
        if (m) {
          req.destroy();
          resolve({ status: 200, view: JSON.parse(m[1]) });
        }
      });
    });
    req.on("error", (err) => (String(err).includes("socket hang up") ? undefined : reject(err)));
    req.end();
  });
}

const TEACH = { "x-teach-token": "teach-secret" };
const teach = (body: unknown, headers: Record<string, string> = TEACH) => call("POST", "/api/teach/act", { headers, body });
async function enter(name: string): Promise<string> {
  const res = await call("POST", "/api/join", { body: { name } });
  expect(res.status).toBe(200);
  return JSON.parse(res.body).token as string;
}
async function seatId(name: string): Promise<string> {
  const { view } = await firstView("/api/teach/stream", TEACH);
  return (view!.seats as { id: string; name: string }[]).find((s) => s.name === name)!.id;
}

describe("the pieces", () => {
  it("compares secrets in constant time, whatever their length", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abcd", "abc")).toBe(false);
    expect(sameSecret("", "abc")).toBe(false);
    expect(sameSecret(undefined, "abc")).toBe(false);
  });

  it("tells a request from this computer from one through a tunnel or the network", () => {
    expect(isLocal({ headers: { host: "127.0.0.1:4870" } }, 4870)).toBe(true);
    expect(isLocal({ headers: { host: "localhost:4870" } }, 4870)).toBe(true);
    expect(isLocal({ headers: { host: "class.example.org" } }, 4870)).toBe(false);
    expect(isLocal({ headers: { host: "127.0.0.1:4870", "cf-connecting-ip": "1.2.3.4" } }, 4870)).toBe(false);
    expect(isLocal({ headers: { host: "127.0.0.1:4870", "x-forwarded-for": "1.2.3.4" } }, 4870)).toBe(false);
    // From another computer (--lan), even naming this one as the host.
    expect(isLocal({ headers: { host: "127.0.0.1:4870" }, socket: { remoteAddress: "192.168.1.20" } }, 4870)).toBe(false);
    expect(isLocal({ headers: { host: "127.0.0.1:4870" }, socket: { remoteAddress: "::ffff:127.0.0.1" } }, 4870)).toBe(true);
  });

  it("rate-limits per key, per window", () => {
    const limit = new RateLimit(2, 1000);
    expect([limit.allow("a", 0), limit.allow("a", 1), limit.allow("a", 2), limit.allow("b", 2), limit.allow("a", 1000)]).toEqual([true, true, false, true, true]);
  });
});

describe("the instructor", () => {
  it("needs the token", async () => {
    expect((await teach({ type: "tick" }, {})).status).toBe(404);
    expect((await teach({ type: "tick" }, { "x-teach-token": "teach-secreT" })).status).toBe(404);
    expect((await firstView("/api/teach/stream", { "x-teach-token": "nope" })).status).toBe(404);
    expect((await teach({ type: "tick" })).status).toBe(200);
  });

  it("is never reachable through the tunnel, token or not", async () => {
    const tunnel = { ...TEACH, host: "class.example.org", "cf-connecting-ip": "203.0.113.9", "cf-ray": "x" };
    expect((await teach({ type: "tick" }, tunnel)).status).toBe(404);
    expect((await firstView("/api/teach/stream", tunnel)).status).toBe(404);
    expect((await call("GET", "/teach", { headers: { host: "class.example.org", "cf-ray": "x" } })).status).toBe(404);
    expect((await call("GET", "/instructor.js", { headers: { host: "class.example.org", "cf-ray": "x" } })).status).toBe(404);
    // The students' page is.
    expect((await call("GET", "/", { headers: { host: "class.example.org", "cf-ray": "x" } })).status).toBe(200);
  });
});

describe("students", () => {
  it("act only with their own seat's token", async () => {
    const tobi = await enter("Tobi");
    await enter("Kemi");
    await teach({ type: "assign", seat: await seatId("Tobi"), role: "cpu-1" });
    await teach({ type: "assign", seat: await seatId("Kemi"), role: "memory" });
    await teach({ type: "tick" });
    expect((await call("POST", "/api/act", { body: { type: "done" } })).status).toBe(401);
    expect((await call("POST", "/api/act", { headers: { "x-seat-token": "forged" }, body: { type: "done" } })).status).toBe(401);
    const sent = await call("POST", "/api/act", { headers: { "x-seat-token": tobi }, body: { type: "send", id: "c1-1", to: "memory", text: "mem.read 2" } });
    expect(sent.status).toBe(200);
    // A student can't reach the bus's controls with their own token.
    expect((await teach({ type: "deliver", seq: 1 }, { "x-teach-token": tobi })).status).toBe(404);
    const { view } = await firstView("/api/stream", { "x-seat-token": tobi });
    expect(view).toMatchObject({ me: { name: "Tobi", role: "cpu-1" }, sent: [{ id: "c1-1", status: "pending" }] });
    expect(JSON.stringify(view)).not.toMatch(/= 42|"seats"|teach-secret/);
  });

  it("are capped: body size, content type, joins per client, a closed class", async () => {
    expect((await call("POST", "/api/join", { body: { name: "x".repeat(5000) } })).status).toBe(400);
    expect((await call("POST", "/api/join", { headers: { "content-type": "text/plain" }, body: "name=x" })).status).toBe(400);
    expect((await call("POST", "/api/join", { body: "[1]" })).status).toBe(400);
    expect((await call("POST", "/api/join", { headers: { origin: "https://evil.example" }, body: { name: "x" } })).status).toBe(403);
    await teach({ type: "lock", locked: true });
    expect((await call("POST", "/api/join", { body: { name: "Late" } })).status).toBe(403);
    await teach({ type: "lock", locked: false });
    // A whole class on one campus address can join (up to 45 seats from one address).
    const from = (ip: string) => ({ headers: { "cf-connecting-ip": ip }, body: { name: `p-${ip}` } });
    const statuses = [];
    for (let i = 0; i < 47; i++) statuses.push((await call("POST", "/api/join", from("198.51.100.7"))).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(45);
    expect(statuses.slice(45)).toEqual([429, 429]);
    expect((await call("POST", "/api/join", from("198.51.100.8"))).status).toBe(200);
  });

  it("lose their seat when the instructor removes them", async () => {
    const troll = await enter("Troll");
    expect((await teach({ type: "kick", seat: await seatId("Troll") })).status).toBe(200);
    expect((await call("POST", "/api/act", { headers: { "x-seat-token": troll }, body: { type: "note", text: "hi" } })).status).toBe(401);
    expect((await firstView("/api/stream", { "x-seat-token": troll })).status).toBe(401);
  });

  it("get every page with a strict content security policy", async () => {
    const res = await call("GET", "/");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'; script-src 'self'/);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect((await call("GET", "/../server.ts")).status).toBe(404);
    expect((await call("GET", "/public/student.js")).status).toBe(404);
  });
});

describe("reset", () => {
  it("is the instructor's only, keeps seats on a restart, and revokes every seat on a clear", async () => {
    const tobi = await enter("Tobi");
    await teach({ type: "assign", seat: await seatId("Tobi"), role: "cpu-1" });
    await teach({ type: "tick" });
    expect((await call("POST", "/api/act", { headers: { "x-seat-token": tobi }, body: { type: "send", id: "c1-1", kind: "mem.read", to: "memory", arg: "2" } })).status).toBe(200);
    expect((await teach({ type: "reset" }, { "x-seat-token": tobi })).status).toBe(404);
    expect((await teach({ type: "reset" }, { ...TEACH, host: "class.example.org", "cf-ray": "x" })).status).toBe(404);

    expect((await teach({ type: "reset", clear: false })).status).toBe(200);
    const { view } = await firstView("/api/stream", { "x-seat-token": tobi });
    expect(view).toMatchObject({ phase: "lobby", tick: 0, restarts: 1, sent: [], me: { name: "Tobi", role: "cpu-1" } });

    expect((await teach({ type: "reset", clear: true })).status).toBe(200);
    expect((await firstView("/api/stream", { "x-seat-token": tobi })).status).toBe(401);
    expect((await call("POST", "/api/act", { headers: { "x-seat-token": tobi }, body: { type: "done" } })).status).toBe(401);
    expect(await enter("Tobi")).toBeTruthy();
    // Nothing written.
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("streams", () => {
  it("leave the instructor's page out of the students' cap, and limit stream opens per seat", async () => {
    const tobi = await enter("Tobi");
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await firstView("/api/stream", { "x-seat-token": tobi })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await firstView("/api/teach/stream", TEACH)).status).toBe(200);
  });
});

describe("End and export", () => {
  it("writes the session into the exports folder, once", async () => {
    const tobi = await enter("Tobi");
    await teach({ type: "assign", seat: await seatId("Tobi"), role: "cpu-1" });
    await teach({ type: "tick" });
    // The server checks the fixed form itself (never trusting the page).
    expect((await call("POST", "/api/act", { headers: { "x-seat-token": tobi }, body: { type: "send", id: "c1-1", to: "memory", kind: "mem.read", arg: "<b>2</b>" } })).status).toBe(400);
    await call("POST", "/api/act", { headers: { "x-seat-token": tobi }, body: { type: "send", id: "c1-1", to: "memory", kind: "mem.read", arg: "2" } });
    await teach({ type: "deliver", seq: 1 });
    const res = await teach({ type: "end" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).value).toEqual({ json: "week-02/2026-10-12.json", html: "week-02/2026-10-12.html" });
    const dir = join(root, "week-02");
    expect(readdirSync(dir).sort()).toEqual(["2026-10-12.html", "2026-10-12.json", "index.html"]);
    expect(readdirSync(root)).toEqual(["week-02"]);
    const html = readFileSync(join(dir, "2026-10-12.html"), "utf8");
    expect(html).toContain("mem.read 2");
    expect(html).not.toContain("<b>2</b>");
    expect(readFileSync(join(dir, "index.html"), "utf8")).toContain('href="2026-10-12.html"');
    // Pressing it again doesn't write a second copy.
    expect(JSON.parse((await teach({ type: "end" })).body).value.html).toBe("week-02/2026-10-12.html");
    expect(readdirSync(dir)).toHaveLength(3);
    expect((await call("POST", "/api/join", { body: { name: "Late" } })).status).toBe(400);
  });

  it("keeps an earlier session of the same day", async () => {
    await teach({ type: "end" });
    await live.close();
    live = createLive({ exercise: WEEK_02_ACT_IT_OUT, root, files: FILES, now: () => clock, token: "teach-secret" });
    port = await live.listen(0);
    await teach({ type: "end" });
    const dir = join(root, "week-02");
    expect(readdirSync(dir).sort()).toEqual(["2026-10-12-2.html", "2026-10-12-2.json", "2026-10-12.html", "2026-10-12.json", "index.html"]);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
  });
});
