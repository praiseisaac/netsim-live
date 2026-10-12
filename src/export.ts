// "End and export": a finished session, written out so everyone can see what happened after the
// live server is gone. Under the exports folder (./exports by default):
//
//   week-NN/<date>.json   the whole session, as data
//   week-NN/<date>.html   a replay to read, tick by tick (self-contained, offline)
//   week-NN/index.html    every session of that week, newest first
//
// Everything here is pure: the server (server.ts) does the one write. Every piece of text a person
// typed is escaped before it goes into a page.
import type { LogEvent, Message, SessionState } from "./engine";

export const EXPORT_VERSION = 1;

/** A log event with its time as an ISO string (distributed over the union, so each kind keeps its fields). */
type DatedEvent = LogEvent extends infer E ? (E extends LogEvent ? Omit<E, "at"> & { at: string } : never) : never;

export interface ExportRecord {
  version: number;
  exercise: { id: string; week: number; title: string; summary: string; instructor: string; rules: string[]; examples: string[]; questions: string[]; glossary: string[] };
  startedAt: string | null;
  endedAt: string | null;
  exportedAt: string;
  ticks: number;
  roles: { id: string; label: string; job: string; playedBy: string[]; secret: string | null }[];
  people: { name: string; role: string | null }[];
  messages: (Omit<Message, "sentAt" | "decidedAt"> & { sentAt: string; decidedAt: string | null })[];
  notes: { seq: number; name: string; role: string | null; tick: number; at: string; text: string }[];
  log: DatedEvent[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The session as data. No seat ids or tokens: only names, roles, messages and notes. */
export function exportRecord(s: SessionState, exportedAt: number): ExportRecord {
  const ex = s.exercise;
  const playedBy = new Map<string, string[]>();
  for (const e of s.log) {
    if (e.type === "assign" && e.name) playedBy.set(e.role, [...(playedBy.get(e.role) ?? []).filter((n) => n !== e.name), e.name]);
  }
  return {
    version: EXPORT_VERSION,
    exercise: { id: ex.id, week: ex.week, title: ex.title, summary: ex.summary, instructor: ex.instructor, rules: ex.rules, examples: ex.examples, questions: ex.questions, glossary: ex.glossary },
    startedAt: s.startedAt === null ? null : iso(s.startedAt),
    endedAt: s.endedAt === null ? null : iso(s.endedAt),
    exportedAt: iso(exportedAt),
    ticks: s.tick,
    roles: ex.roles.map((r) => ({ id: r.id, label: r.label, job: r.job, playedBy: playedBy.get(r.id) ?? [], secret: r.secret && s.revealed.includes(r.id) ? r.secret : null })),
    people: s.seats.map((x) => ({ name: x.name, role: x.role })),
    messages: s.messages.map((m) => ({ ...m, sentAt: iso(m.sentAt), decidedAt: m.decidedAt === null ? null : iso(m.decidedAt) })),
    notes: s.notes.map((n) => ({ seq: n.seq, name: n.name, role: n.role, tick: n.tick, at: iso(n.at), text: n.text })),
    log: s.log.map((e) => ({ ...e, at: iso(e.at) })) as ExportRecord["log"],
  };
}

/** Escape text for HTML element content and quoted attribute values. */
export function escHtml(text: unknown): string {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * The file name for a session exported on `date` (UTC day), not clashing with `existing`:
 * 2026-10-12.json, then 2026-10-12-2.json, … Only digits and dashes, whatever happens.
 */
export function exportName(date: Date, existing: readonly string[]): string {
  const day = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("bad date");
  const taken = new Set(existing.map((f) => f.replace(/\.(json|html)$/, "")));
  if (!taken.has(day)) return day;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${day}-${n}`)) return `${day}-${n}`;
  throw new Error("too many sessions on one day");
}

/** The folder a week's exports go in, inside the exports folder. */
export function exportDir(week: number): string {
  if (!Number.isInteger(week) || week < 1 || week > 99) throw new Error("bad week");
  return `week-${String(week).padStart(2, "0")}`;
}

/** The NetSim lesson pages' look, trimmed to what a replay needs. */
const STYLE = `:root{--bg:#fff;--ink:#16201b;--muted:#56615b;--line:#dfe5e1;--soft:#f3f7f4;--green:#173627;--mint:#5fc79a;--mint-ink:#1f7a55;--red:#d8142a;--yellow:#ffcb12;--code-bg:#f3f5f4;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1512;--ink:#e8efeb;--muted:#9aa8a0;--line:#26312b;--soft:#151d18;--mint-ink:#6fd3a7;--red:#ff5a67;--code-bg:#151d18;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:18px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding-inline:20px}
h1,h2,h3{line-height:1.15;margin:0;text-wrap:balance}h2{font-size:clamp(24px,4vw,30px);font-weight:800}h3{font-size:20px;font-weight:700}
p{margin:0}a{color:var(--mint-ink);text-underline-offset:3px}
code,pre,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}code{background:var(--code-bg);padding:1px 6px;border-radius:4px;font-size:.88em;overflow-wrap:anywhere}
pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:0;font-size:.86em;line-height:1.55}pre code{background:none;padding:0}
.hero{background:var(--green);color:#fff;padding-block:44px 36px}.hero .wrap{display:grid;gap:10px}
.tag{font:700 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#a8e3c8}
.hero h1{font-size:clamp(32px,6vw,52px);font-weight:800;letter-spacing:-.02em}.hero p{font-size:18px;color:#d7e6de;max-width:66ch}
main{display:grid;gap:40px;padding-block:32px 64px}section{display:grid;gap:14px;min-width:0}
.lede{font-size:18px;color:var(--muted);max-width:66ch}
ul,ol{margin:0;padding-left:24px;display:grid;gap:6px}
.note{background:var(--soft);border-left:4px solid var(--yellow);padding:10px 14px;border-radius:0 6px 6px 0}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:16px}th,td{text-align:left;vertical-align:top;padding:8px 12px;border-bottom:1px solid var(--line)}th{background:var(--soft);font-size:14px}
tr:last-child td{border-bottom:0}
.tick{border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:grid;gap:10px}
.tick h3{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.tick h3 small{font-size:14px;font-weight:400;color:var(--muted)}
.ev{list-style:none;padding:0;gap:8px}.ev li{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:start}
.badge{display:inline-block;font:600 12px/1.4 "Inter","Segoe UI",system-ui,sans-serif;border-radius:999px;padding:3px 9px;text-align:center;background:var(--soft);color:var(--muted)}
.b-delivered{background:#dcf3e8;color:#1b7650}.b-dropped,.b-pending{background:#ffe1e4;color:#c4051a}.b-note{background:#fff1c2;color:#6b5200}
.warn{color:var(--red);font-size:15px}.muted{color:var(--muted);font-size:15px}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.btn{font:600 14.5px/1 "Inter","Segoe UI",system-ui,sans-serif;padding:11px 16px;border-radius:8px;border:2px solid var(--ink);background:var(--bg);color:var(--ink);cursor:pointer}
.btn:hover{background:var(--soft)}
.btn.primary{background:var(--yellow);color:#16201b;box-shadow:3px 3px 0 var(--ink)}.btn.primary:hover{background:#ffd84a}
.btn:focus-visible{outline:3px solid var(--mint);outline-offset:2px}
.hidden,.controls[hidden]{display:none}
@media (max-width:560px){.ev li{grid-template-columns:1fr;gap:2px}}`;

function page(title: string, glossaryTerms: string[], body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${glossaryTerms.length ? `<meta name="glossary" content="${escHtml(glossaryTerms.join(", "))}">\n` : ""}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
${body}
${script ? `<script>\n${script}\n</script>\n` : ""}</body>
</html>
`;
}

const roleLabel = (r: ExportRecord, id: string | null) => (id ? (r.roles.find((x) => x.id === id)?.label ?? id) : "watcher");

function messageLine(r: ExportRecord, m: ExportRecord["messages"][number]): string {
  const parts = [`id=${m.id}`, m.replyTo ? `replyTo=${m.replyTo}` : `to=${m.to}`, m.text];
  return `<code>${escHtml(roleLabel(r, m.from))} → bus: ${escHtml(parts.join(" "))}</code>`;
}

function eventItem(r: ExportRecord, e: ExportRecord["log"][number]): string {
  const msg = "message" in e ? r.messages[e.message - 1] : undefined;
  switch (e.type) {
    case "sent": {
      if (!msg) return "";
      const unknown = msg.replyToUnknown ? ` <span class="warn">replyTo ${escHtml(msg.replyTo)} names no message sent before it.</span>` : "";
      const fate = msg.status === "pending" ? ` <span class="warn">The bus never delivered it.</span>` : "";
      return `<li><span class="badge">sent</span><div>${messageLine(r, msg)} <span class="muted">for ${escHtml(roleLabel(r, msg.to))}</span>${unknown}${fate}</div></li>`;
    }
    case "delivered":
    case "dropped":
      if (!msg) return "";
      return `<li><span class="badge b-${e.type}">${e.type}</span><div>The bus ${e.type === "delivered" ? `delivered <code>${escHtml(msg.id)}</code> to ${escHtml(roleLabel(r, msg.to))}` : `dropped <code>${escHtml(msg.id)}</code>; ${escHtml(roleLabel(r, msg.to))} never got it`}${msg.sentTick !== e.tick ? ` <span class="muted">(sent in tick ${msg.sentTick})</span>` : ""}.</div></li>`;
    case "done":
      return `<li><span class="badge">done</span><div>${escHtml(roleLabel(r, e.role))} is done for the tick.</div></li>`;
    case "note": {
      const n = r.notes[e.note - 1];
      return n ? `<li><span class="badge b-note">note</span><div><b>${escHtml(n.name)}</b> <span class="muted">(${escHtml(roleLabel(r, n.role))})</span>: ${escHtml(n.text)}</div></li>` : "";
    }
    case "assign":
      return `<li><span class="badge">role</span><div>${e.name ? `${escHtml(e.name)} plays ${escHtml(roleLabel(r, e.role))}` : `${escHtml(roleLabel(r, e.role))} is free again`}.</div></li>`;
    case "reveal":
      return `<li><span class="badge">private</span><div>The bus gave ${escHtml(roleLabel(r, e.role))} its private information.</div></li>`;
    default:
      return "";
  }
}

const when = (isoTime: string | null) => (isoTime ? escHtml(isoTime.replace("T", " ").slice(0, 16)) + " UTC" : "");

/** The replay page for one session. `decorate` adds the glossary popovers (glossary.ts). */
export function renderReplay(r: ExportRecord, decorate: (html: string) => string = (h) => h): string {
  const ex = r.exercise;
  const byTick = new Map<number, ExportRecord["log"]>();
  for (const e of r.log) {
    if (e.type === "start" || e.type === "end" || e.type === "tick") continue;
    byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
  }
  const tickInfo = new Map(r.log.flatMap((e) => (e.type === "tick" ? [[e.tick, e] as const] : [])));
  const ticks: string[] = [];
  for (let t = 0; t <= r.ticks; t++) {
    const events = (byTick.get(t) ?? []).map((e) => eventItem(r, e)).filter(Boolean);
    if (t === 0 && !events.length) continue;
    const info = tickInfo.get(t);
    const forced = info?.forced ? ` <small>The bus started it before ${escHtml(info.notDone.map((id) => roleLabel(r, id)).join(", "))} sent done.</small>` : "";
    ticks.push(
      `<section class="tick" data-tick="${t}"><h3>${t === 0 ? "Before tick 1" : `Tick ${t}`}${forced}</h3>${events.length ? `<ul class="ev">${events.join("")}</ul>` : `<p class="muted">Nothing happened.</p>`}</section>`,
    );
  }
  const pending = r.messages.filter((m) => m.status === "pending");
  const cast = r.roles
    .map((role) => `<tr><td><b>${escHtml(role.label)}</b></td><td>${role.playedBy.length ? escHtml(role.playedBy.join(", ")) : `<span class="muted">nobody</span>`}</td><td>${escHtml(role.job)}${role.secret ? `<br><span class="muted">Private: ${escHtml(role.secret)}</span>` : ""}</td></tr>`)
    .join("");
  const notes = r.notes.length
    ? `<ul>${r.notes.map((n) => `<li><b>${escHtml(n.name)}</b> <span class="muted">(tick ${n.tick}, ${escHtml(roleLabel(r, n.role))})</span>: ${escHtml(n.text)}</li>`).join("")}</ul>`
    : `<p class="muted">No notes.</p>`;
  const day = r.startedAt ?? r.exportedAt;
  const body = `<header class="hero"><div class="wrap"><p class="tag">Week ${ex.week} · In class · ${escHtml(day.slice(0, 10))}</p><h1>${escHtml(ex.title)}</h1><p>What happened in class, tick by tick: every message, who it was for, and what the bus did with it.</p></div></header>
<main class="wrap">
<section><p class="lede">${escHtml(ex.summary)} Each tick, the roles sent messages to the bus, and the bus delivered them or dropped them. A reply names the request it answers with <code>replyTo</code>; an address memory doesn't have gets a fault. Each message's id, to and replyTo are its envelope.</p>
<p class="muted">${plural(r.ticks, "tick")} · ${plural(r.messages.length, "message")} · ${plural(r.notes.length, "note")} · started ${when(r.startedAt)}${r.endedAt ? `, ended ${when(r.endedAt)}` : ""}</p></section>
<section><h2>Who played what</h2><div class="table-wrap"><table><thead><tr><th>Role</th><th>Played by</th><th>Job</th></tr></thead><tbody>${cast}</tbody></table></div></section>
<section><h2>The rules</h2><ul>${ex.rules.map((rule) => `<li>${escHtml(rule)}</li>`).join("")}</ul><pre><code>${escHtml(ex.examples.join("\n"))}</code></pre></section>
<section><h2>Tick by tick</h2><div class="controls" data-controls hidden><button class="btn" type="button" data-step="first">First</button><button class="btn" type="button" data-step="prev">Previous tick</button><button class="btn primary" type="button" data-step="next">Next tick</button><button class="btn" type="button" data-step="all">Show all</button><span class="muted" data-where></span></div>
${ticks.join("\n") || `<p class="muted">The clock never started.</p>`}
${pending.length ? `<p class="note">${pending.length} message${pending.length === 1 ? " was" : "s were"} still waiting at the bus when the session ended: ${pending.map((m) => `<code>${escHtml(m.id)}</code>`).join(", ")}.</p>` : ""}</section>
<section><h2>What went wrong: the class's notes</h2>${notes}</section>
<section><h2>Questions to answer</h2><ul>${ex.questions.map((q) => `<li>${escHtml(q)}</li>`).join("")}</ul></section>
<p class="muted">The data behind this page is the <code>.json</code> file next to it.</p>
</main>`;
  // Step through the ticks (everything shows without JavaScript).
  const script = `(()=>{const ticks=[...document.querySelectorAll("[data-tick]")];const bar=document.querySelector("[data-controls]");if(!ticks.length||!bar)return;bar.hidden=false;
const where=bar.querySelector("[data-where]");const last=ticks.length-1;let at=last,all=true;
const show=()=>{ticks.forEach((t,i)=>t.classList.toggle("hidden",!all&&i>at));where.textContent=all?"Showing every tick":"Up to: "+ticks[at].querySelector("h3").firstChild.textContent;};
bar.addEventListener("click",(e)=>{const b=e.target.closest("button");if(!b)return;const s=b.dataset.step;
if(s==="all")all=true;else if(s==="first"){all=false;at=0;}else if(s==="prev"){at=Math.max(0,(all?last:at)-1);all=false;}else if(s==="next"){at=all?0:Math.min(last,at+1);all=false;}show();});show();})();`;
  return decorate(page(`NetSim Week ${ex.week} · In class · ${day.slice(0, 10)}`, ex.glossary, body, script));
}

export interface IndexEntry {
  name: string;
  title: string;
  startedAt: string | null;
  ticks: number;
  messages: number;
  notes: number;
}

export function indexEntry(name: string, r: ExportRecord): IndexEntry {
  // Read back from files on disk: numbers are forced to numbers before they reach the page.
  return { name, title: String(r.exercise?.title ?? ""), startedAt: String(r.startedAt ?? ""), ticks: Number(r.ticks) || 0, messages: Number(r.messages?.length) || 0, notes: Number(r.notes?.length) || 0 };
}

/** A week's in-class page: every exported session, newest first (or a note that none is yet). */
export function renderIndex(week: number, entries: IndexEntry[], liveUrl: string): string {
  const sorted = [...entries].sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }));
  const list = sorted.length
    ? `<ul>${sorted.map((e) => `<li><a href="${escHtml(e.name)}.html">${escHtml(e.name)}: ${escHtml(e.title)}</a> <span class="muted">${plural(e.ticks, "tick")} · ${plural(e.messages, "message")} · ${plural(e.notes, "note")}</span></li>`).join("")}</ul>`
    : `<p class="note">Nothing here yet. During class, the exercise runs live at <a href="${escHtml(liveUrl)}">${escHtml(liveUrl)}</a>; when it ends, the record of what happened shows up on this page.</p>`;
  return page(
    `NetSim Week ${week} · In class`,
    [],
    `<header class="hero"><div class="wrap"><p class="tag">Week ${week} · In class</p><h1>In-class exercise</h1><p>The record of each in-class exercise: what everyone sent, what the bus did, and what the class noticed.</p></div></header>
<main class="wrap"><section><h2>Sessions</h2>${list}</section></main>`,
  );
}
