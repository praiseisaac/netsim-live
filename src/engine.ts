// The in-class exercise engine: one live session of an exercise (exercises.ts), as a pure state
// machine. The server (server.ts) owns the network, the tokens and the clock; this file only
// decides what each action does to the session and what each person may see.
//
// The rules it keeps are the act-it-out's:
//   - nobody acts between ticks: a role can only send during a tick, and not after its `done`
//   - every message goes to the bus (the instructor), who delivers it or drops it
//   - every message has an `id`; a reply names the `id` it answers (`replyTo`)
//   - each role sends `done`; the bus starts the next tick when all have (or forces it)
//   - a role's private information (MEMORY's bytes) is shown only to that role, once revealed

export interface RoleDef {
  id: string;
  label: string;
  /** What this role does, in a sentence, shown to the person playing it. */
  job: string;
  /** Suggested id prefix, like "c1-" for CPU-1's c1-1, c1-2, … */
  idPrefix: string;
  /** Information only this role sees, once the bus reveals it (MEMORY's bytes). */
  secret?: string;
}

/** What a fixed message carries after its name: a number in a range, or one of a few words. */
export type MessageArg =
  | { name: string; hint: string; kind: "number"; min: number; max: number }
  | { name: string; hint: string; kind: "choice"; options: string[] };

/** One of the messages the module defines (week 2: mem.read, mem.data, fault, irq). */
export interface MessageDef {
  /** Its name, as the module writes it: "mem.read". */
  kind: string;
  /** What it means, in plain words. */
  hint: string;
  /** The roles that send it. */
  from: string[];
  /** Who it goes to, or "reply": back to whoever sent the message it answers (named in replyTo). */
  to: string[] | "reply";
  /** For a reply: the messages it answers. */
  answers?: string[];
  arg?: MessageArg;
}

/** The send form's fields: what each one is for, in plain words. */
export type FieldHints = Record<"id" | "kind" | "to" | "replyTo", string>;

export interface ExerciseDef {
  id: string;
  week: number;
  title: string;
  summary: string;
  /** What the instructor plays. */
  instructor: string;
  roles: RoleDef[];
  rules: string[];
  /** Example messages, shown to everyone. */
  examples: string[];
  /** Questions to answer afterwards. */
  questions: string[];
  /** Glossary terms (glossary/glossary.json) the exported replay explains. */
  glossary: string[];
  /** The fixed messages the roles send (picked from a list, checked field by field). Without
   *  them, a message is free text. */
  messages?: MessageDef[];
  fields?: FieldHints;
}

export type SendField = "id" | "kind" | "to" | "replyTo" | "arg";
export interface SendInput {
  id?: unknown;
  to?: unknown;
  replyTo?: unknown;
  /** A fixed message's name and argument… */
  kind?: unknown;
  arg?: unknown;
  /** …or the whole message as text ("mem.read 2"), split into those two. */
  text?: unknown;
}

/**
 * Check a fixed-form message the way the page does (student.js's check() mirrors this): every
 * field's problem in plain words, or the message's parts when there are none.
 */
export function checkFixed(
  s: SessionState,
  from: string,
  input: SendInput,
): { errors: Partial<Record<SendField, string>>; kind: string; arg: string; to: string; replyTo: string | null } {
  const errors: Partial<Record<SendField, string>> = {};
  const role = roleOf(s, from)!;
  const defs = s.exercise.messages ?? [];
  let kind = clean(input.kind, 40);
  let arg = clean(input.arg, 40);
  if (!kind && typeof input.text === "string") {
    const [first = "", ...rest] = clean(input.text, LIMITS.text).split(" ");
    kind = first;
    arg = rest.join(" ");
  }
  const id = clean(input.id, LIMITS.id + 1);
  const prefix = role.idPrefix;
  if (!id) errors.id = `Give it an id, like ${prefix}1.`;
  else if (!id.toLowerCase().startsWith(prefix.toLowerCase()) || !/^\d+$/.test(id.slice(prefix.length))) errors.id = `${role.label}'s ids are ${prefix} and a number, like ${prefix}1, ${prefix}2.`;
  else if (s.messages.some((m) => m.id.toLowerCase() === id.toLowerCase())) errors.id = `${id} is already used: take the next number.`;

  const def = defs.find((d) => d.kind === kind);
  let to = typeof input.to === "string" ? input.to : "";
  let replyTo: string | null = null;
  if (!kind) errors.kind = "Pick a message.";
  else if (!def) errors.kind = `There's no message called ${kind}.`;
  else if (!def.from.includes(from)) errors.kind = `${role.label} doesn't send ${kind}.`;
  else {
    if (def.to === "reply") {
      const ref = clean(input.replyTo, LIMITS.id + 1);
      const asked = ref ? s.messages.find((m) => m.id.toLowerCase() === ref.toLowerCase() && m.to === from && m.status === "delivered") : undefined;
      const answers = (def.answers ?? []).join(" or ");
      if (!ref) errors.replyTo = `${kind} is an answer: put the id of the message it answers here.`;
      else if (!asked) errors.replyTo = `${ref} isn't a message the bus delivered to you.`;
      else if (def.answers && !def.answers.some((a) => asked.text === a || asked.text.startsWith(`${a} `))) errors.replyTo = `${kind} answers ${answers}; ${asked.id} is ${asked.text}.`;
      else {
        replyTo = asked.id;
        to = asked.from;
      }
    } else {
      const label = def.to.map((r) => roleOf(s, r)?.label ?? r).join(" or ");
      if (!to) errors.to = `Pick who it's for: ${kind} goes to ${label}.`;
      else if (!def.to.includes(to)) errors.to = `${kind} goes to ${label}, not ${roleOf(s, to)?.label ?? to}.`;
    }
    const a = def.arg;
    if (a?.kind === "number") {
      if (!arg) errors.arg = `Fill in the ${a.name}.`;
      else if (!/^\d+$/.test(arg) || Number(arg) < a.min || Number(arg) > a.max) errors.arg = `The ${a.name} is a whole number from ${a.min} to ${a.max}.`;
      else arg = String(Number(arg));
    } else if (a?.kind === "choice") {
      if (!a.options.includes(arg)) errors.arg = `The ${a.name} is ${a.options.join(" or ")}.`;
    } else arg = "";
  }
  return { errors, kind, arg, to, replyTo };
}

export type Phase = "lobby" | "running" | "ended";
export type MessageStatus = "pending" | "delivered" | "dropped";

export interface Seat {
  id: string;
  name: string;
  /** The role this seat plays, or null for a watcher. */
  role: string | null;
  joinedAt: number;
}

export interface Message {
  seq: number;
  /** The sender's own ticket number, like c1-1. */
  id: string;
  from: string;
  to: string;
  replyTo: string | null;
  /** Set when replyTo names no message sent so far: a mistake worth seeing. */
  replyToUnknown: boolean;
  text: string;
  sentTick: number;
  sentAt: number;
  status: MessageStatus;
  /** The tick the bus delivered or dropped it in. */
  decidedTick: number | null;
  decidedAt: number | null;
}

export interface Note {
  seq: number;
  seat: string;
  name: string;
  role: string | null;
  tick: number;
  at: number;
  text: string;
}

export type LogEvent =
  | { seq: number; at: number; tick: number; type: "start" | "end" }
  | { seq: number; at: number; tick: number; type: "tick"; forced: boolean; notDone: string[] }
  | { seq: number; at: number; tick: number; type: "assign"; role: string; name: string | null }
  | { seq: number; at: number; tick: number; type: "reveal"; role: string }
  | { seq: number; at: number; tick: number; type: "done"; role: string }
  | { seq: number; at: number; tick: number; type: "sent" | "delivered" | "dropped"; message: number }
  | { seq: number; at: number; tick: number; type: "note"; note: number };

export interface SessionState {
  exercise: ExerciseDef;
  phase: Phase;
  tick: number;
  startedAt: number | null;
  endedAt: number | null;
  seats: Seat[];
  messages: Message[];
  notes: Note[];
  /** Roles that have sent `done` in the current tick. */
  done: string[];
  /** Roles whose secret the bus has revealed (to them only). */
  revealed: string[];
  log: LogEvent[];
  /** How many times the instructor has reset the exercise (pages show a note when it goes up). */
  restarts: number;
}

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export const LIMITS = {
  name: 24,
  id: 16,
  text: 120,
  note: 280,
  seats: 60,
  messages: 400,
  notes: 300,
} as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

/**
 * Text as typed, made safe to keep: control characters out (newlines become spaces), whitespace
 * collapsed, trimmed. Escaping for HTML happens where it's shown, never here.
 */
export function clean(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return [...flat].slice(0, max).join("");
}

export function createSession(exercise: ExerciseDef): SessionState {
  return { exercise, phase: "lobby", tick: 0, startedAt: null, endedAt: null, seats: [], messages: [], notes: [], done: [], revealed: [], log: [], restarts: 0 };
}

function nextSeq(s: SessionState): number {
  return s.log.length + 1;
}

function log(s: SessionState, at: number, event: Record<string, unknown> & { type: LogEvent["type"] }): void {
  s.log.push({ seq: nextSeq(s), at, tick: s.tick, ...event } as LogEvent);
}

function roleOf(s: SessionState, role: string): RoleDef | undefined {
  return s.exercise.roles.find((r) => r.id === role);
}

export function seatOf(s: SessionState, seat: string): Seat | undefined {
  return s.seats.find((x) => x.id === seat);
}

/** The roles somebody plays right now: the ones the clock waits for. */
export function playedRoles(s: SessionState): string[] {
  return s.exercise.roles.map((r) => r.id).filter((id) => s.seats.some((seat) => seat.role === id));
}

/** A new seat, as a watcher. The seat id comes from the server (random). */
export function join(s: SessionState, seat: string, name: unknown, at: number): Result<Seat> {
  if (s.phase === "ended") return fail("This session has ended.");
  if (s.seats.length >= LIMITS.seats) return fail("The class is full.");
  if (seatOf(s, seat)) return fail("That seat is taken.");
  const display = clean(name, LIMITS.name);
  if (!display) return fail("Type your name first.");
  const taken = new Set(s.seats.map((x) => x.name.toLowerCase()));
  let unique = display;
  for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${[...display].slice(0, LIMITS.name - 3).join("")} (${n})`;
  const created: Seat = { id: seat, name: unique, role: null, joinedAt: at };
  s.seats.push(created);
  return ok(created);
}

/** Give a role to a seat (or `null` to make it a watcher). A role has one seat at a time. */
export function assign(s: SessionState, seat: string, role: string | null, at: number): Result {
  if (s.phase === "ended") return fail("This session has ended.");
  const target = seatOf(s, seat);
  if (!target) return fail("No such seat.");
  if (role !== null && !roleOf(s, role)) return fail("No such role.");
  if (target.role === role) return ok(undefined);
  const previous = target.role;
  if (role !== null) {
    for (const other of s.seats) if (other.role === role) other.role = null;
  }
  target.role = role;
  if (previous) log(s, at, { type: "assign", role: previous, name: null });
  if (role) log(s, at, { type: "assign", role, name: target.name });
  return ok(undefined);
}

/** Take a seat out of the class (its role is free again). What it already sent and wrote stays. */
export function removeSeat(s: SessionState, seat: string, at: number): Result {
  const target = seatOf(s, seat);
  if (!target) return fail("No such seat.");
  if (target.role && s.phase !== "ended") assign(s, seat, null, at);
  s.seats = s.seats.filter((x) => x.id !== seat);
  return ok(undefined);
}

/** Fill the empty roles with the watchers who joined first. */
export function autoAssign(s: SessionState, at: number): Result {
  if (s.phase === "ended") return fail("This session has ended.");
  const watchers = s.seats.filter((x) => x.role === null);
  for (const role of s.exercise.roles) {
    if (s.seats.some((x) => x.role === role.id)) continue;
    const next = watchers.shift();
    if (!next) break;
    assign(s, next.id, role.id, at);
  }
  return ok(undefined);
}

/** Show a role its private information. */
export function reveal(s: SessionState, role: string, at: number): Result {
  const def = roleOf(s, role);
  if (!def?.secret) return fail("That role has nothing private.");
  if (!s.revealed.includes(role)) {
    s.revealed.push(role);
    log(s, at, { type: "reveal", role });
  }
  return ok(undefined);
}

/**
 * The clock: the first call starts tick 1, each later one the next tick. Unless forced, every
 * played role must have sent `done` first.
 */
export function tick(s: SessionState, force: boolean, at: number): Result<number> {
  if (s.phase === "ended") return fail("This session has ended.");
  const notDone = playedRoles(s).filter((r) => !s.done.includes(r));
  if (s.phase === "running" && notDone.length && !force) return fail(`Waiting for done from ${notDone.map((r) => roleOf(s, r)?.label ?? r).join(", ")}.`);
  if (s.phase === "lobby") {
    s.phase = "running";
    s.startedAt = at;
    log(s, at, { type: "start" });
  }
  s.tick++;
  s.done = [];
  log(s, at, { type: "tick", forced: s.tick > 1 && notDone.length > 0, notDone: s.tick > 1 ? notDone : [] });
  return ok(s.tick);
}

/** Why the seat's role can't act right now, or "" when it can. */
function cannotAct(s: SessionState, seat: Seat | undefined): string {
  if (!seat) return "No such seat.";
  if (!seat.role) return "Watchers don't send messages: post a note instead.";
  if (s.phase === "lobby") return "Wait for tick 1: nobody acts between ticks.";
  if (s.phase === "ended") return "This session has ended.";
  if (s.done.includes(seat.role)) return `You've sent done for tick ${s.tick}. Wait for the next tick.`;
  return "";
}

/** A role sends a message to the bus, for another role. */
export function send(s: SessionState, seat: string, input: SendInput, at: number): Result<Message> {
  const who = seatOf(s, seat);
  const why = cannotAct(s, who);
  if (why) return fail(why);
  const from = who!.role!;
  if (s.messages.length >= LIMITS.messages) return fail("The bus is full for this session.");
  if (s.exercise.messages) {
    // Fixed messages: checked field by field, never trusting the page to have done it.
    const c = checkFixed(s, from, input);
    const first = (["id", "kind", "to", "replyTo", "arg"] as const).map((f) => c.errors[f]).find(Boolean);
    if (first) return fail(first);
    return ok(push(s, at, { id: clean(input.id, LIMITS.id), from, to: c.to, replyTo: c.replyTo, text: c.arg ? `${c.kind} ${c.arg}` : c.kind }));
  }
  const id = clean(input.id, LIMITS.id + 1);
  if (!id) return fail("Give the message an id, like c1-1.");
  if (id.length > LIMITS.id || !ID.test(id)) return fail(`An id is up to ${LIMITS.id} letters, digits, dots, dashes or underscores, like c1-1.`);
  if (s.messages.some((m) => m.id.toLowerCase() === id.toLowerCase())) return fail(`id ${id} is already used. Number your ids: c1-1, c1-2, …`);
  const to = typeof input.to === "string" ? input.to : "";
  if (!roleOf(s, to)) return fail("Pick who the message is for.");
  if (to === from) return fail("A message to yourself doesn't need the bus.");
  const replyRaw = clean(input.replyTo, LIMITS.id + 1);
  if (replyRaw && (replyRaw.length > LIMITS.id || !ID.test(replyRaw))) return fail("replyTo is the id of the message you answer, like c1-1.");
  const text = clean(input.text, LIMITS.text);
  if (!text) return fail("Say what the message is, like mem.read 2.");
  return ok(push(s, at, { id, from, to, replyTo: replyRaw || null, text }));
}

function push(s: SessionState, at: number, m: { id: string; from: string; to: string; replyTo: string | null; text: string }): Message {
  const message: Message = {
    seq: s.messages.length + 1,
    ...m,
    replyToUnknown: !!m.replyTo && !s.messages.some((x) => x.id.toLowerCase() === m.replyTo!.toLowerCase()),
    sentTick: s.tick,
    sentAt: at,
    status: "pending",
    decidedTick: null,
    decidedAt: null,
  };
  s.messages.push(message);
  log(s, at, { type: "sent", message: message.seq });
  return message;
}

/** The bus delivers a pending message to its recipient, or drops it. */
export function decide(s: SessionState, seq: number, deliver: boolean, at: number): Result {
  if (s.phase !== "running") return fail(s.phase === "ended" ? "This session has ended." : "Start the clock first.");
  const message = s.messages.find((m) => m.seq === seq);
  if (!message) return fail("No such message.");
  if (message.status !== "pending") return fail(`That message was already ${message.status}.`);
  message.status = deliver ? "delivered" : "dropped";
  message.decidedTick = s.tick;
  message.decidedAt = at;
  log(s, at, { type: deliver ? "delivered" : "dropped", message: seq });
  return ok(undefined);
}

/** A role is done for this tick. */
export function done(s: SessionState, seat: string, at: number): Result {
  const who = seatOf(s, seat);
  const why = cannotAct(s, who);
  if (why) return fail(why);
  s.done.push(who!.role!);
  log(s, at, { type: "done", role: who!.role! });
  return ok(undefined);
}

/** Anyone in the class posts a "what went wrong" note. */
export function note(s: SessionState, seat: string, text: unknown, at: number): Result<Note> {
  const who = seatOf(s, seat);
  if (!who) return fail("No such seat.");
  if (s.phase === "ended") return fail("This session has ended.");
  if (s.notes.length >= LIMITS.notes) return fail("That's enough notes for one session.");
  const body = clean(text, LIMITS.note);
  if (!body) return fail("Write the note first.");
  const created: Note = { seq: s.notes.length + 1, seat: who.id, name: who.name, role: who.role, tick: s.tick, at, text: body };
  s.notes.push(created);
  log(s, at, { type: "note", note: created.seq });
  return ok(created);
}

export function end(s: SessionState, at: number): Result {
  if (s.phase === "ended") return fail("This session has already ended.");
  s.phase = "ended";
  s.endedAt = at;
  log(s, at, { type: "end" });
  return ok(undefined);
}

/**
 * Start the exercise again: back to waiting for tick 1, with no messages, timeline, notes, done
 * states or reveals. Everyone stays joined in their roles, or with `clearSeats`, the class is
 * emptied too (the server then revokes their tokens).
 */
export function restart(s: SessionState, clearSeats: boolean): Result {
  s.phase = "lobby";
  s.tick = 0;
  s.startedAt = null;
  s.endedAt = null;
  s.messages = [];
  s.notes = [];
  s.done = [];
  s.revealed = [];
  s.log = [];
  if (clearSeats) s.seats = [];
  s.restarts++;
  return ok(undefined);
}

// ---- What each person sees ----

/** A message as the class sees it on the timeline (delivered or dropped only). */
export interface PublicMessage {
  seq: number;
  id: string;
  from: string;
  to: string;
  replyTo: string | null;
  replyToUnknown: boolean;
  text: string;
  sentTick: number;
  status: "delivered" | "dropped";
  decidedTick: number;
}

export type TimelineItem = { kind: "tick"; tick: number; forced: boolean; notDone: string[] } | { kind: "message"; message: PublicMessage } | { kind: "end"; tick: number };

function publicMessage(m: Message): PublicMessage {
  return { seq: m.seq, id: m.id, from: m.from, to: m.to, replyTo: m.replyTo, replyToUnknown: m.replyToUnknown, text: m.text, sentTick: m.sentTick, status: m.status as "delivered" | "dropped", decidedTick: m.decidedTick ?? m.sentTick };
}

/** The shared timeline: each tick, and what the bus delivered or dropped, in order. */
export function timeline(s: SessionState): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const e of s.log) {
    if (e.type === "tick") out.push({ kind: "tick", tick: e.tick, forced: e.forced, notDone: e.notDone });
    else if (e.type === "delivered" || e.type === "dropped") out.push({ kind: "message", message: publicMessage(s.messages[e.message - 1]) });
    else if (e.type === "end") out.push({ kind: "end", tick: e.tick });
  }
  return out;
}

interface CommonView {
  exercise: { id: string; week: number; title: string; summary: string; instructor: string; rules: string[]; examples: string[]; questions: string[]; messages: MessageDef[] | null; fields: FieldHints | null; roles: { id: string; label: string; job: string; idPrefix: string; hasSecret: boolean }[] };
  phase: Phase;
  tick: number;
  restarts: number;
  /** Who plays each role (display names), and who is done this tick. */
  cast: { role: string; name: string | null; done: boolean }[];
  watchers: number;
  timeline: TimelineItem[];
  notes: { seq: number; name: string; role: string | null; tick: number; text: string }[];
}

export interface StudentView extends CommonView {
  me: { seat: string; name: string; role: string | null; secret: string | null; canAct: boolean; why: string };
  /** Messages the bus delivered to my role. */
  inbox: PublicMessage[];
  /** What my role sent this session, with what happened to each. */
  sent: { seq: number; id: string; to: string; replyTo: string | null; text: string; sentTick: number; status: MessageStatus; decidedTick: number | null }[];
}

export interface InstructorView extends CommonView {
  seats: { id: string; name: string; role: string | null }[];
  /** Every message, pending ones first-come first. */
  messages: Message[];
  revealed: string[];
  secrets: { role: string; secret: string }[];
  waitingFor: string[];
}

function common(s: SessionState): CommonView {
  const ex = s.exercise;
  return {
    exercise: {
      id: ex.id,
      week: ex.week,
      title: ex.title,
      summary: ex.summary,
      instructor: ex.instructor,
      rules: ex.rules,
      examples: ex.examples,
      questions: ex.questions,
      messages: ex.messages ?? null,
      fields: ex.fields ?? null,
      roles: ex.roles.map((r) => ({ id: r.id, label: r.label, job: r.job, idPrefix: r.idPrefix, hasSecret: !!r.secret })),
    },
    phase: s.phase,
    restarts: s.restarts,
    tick: s.tick,
    cast: ex.roles.map((r) => ({ role: r.id, name: s.seats.find((x) => x.role === r.id)?.name ?? null, done: s.done.includes(r.id) })),
    watchers: s.seats.filter((x) => x.role === null).length,
    timeline: timeline(s),
    notes: s.notes.map((n) => ({ seq: n.seq, name: n.name, role: n.role, tick: n.tick, text: n.text })),
  };
}

/** What one seat sees: never another role's secret, and never a message the bus hasn't delivered to it. */
export function studentView(s: SessionState, seat: string): StudentView | null {
  const me = seatOf(s, seat);
  if (!me) return null;
  const role = me.role;
  const def = role ? roleOf(s, role) : undefined;
  const why = cannotAct(s, me);
  return {
    ...common(s),
    me: { seat: me.id, name: me.name, role, secret: role && def?.secret && s.revealed.includes(role) ? def.secret : null, canAct: !why, why },
    inbox: role ? s.messages.filter((m) => m.to === role && m.status === "delivered").map(publicMessage) : [],
    sent: role ? s.messages.filter((m) => m.from === role).map((m) => ({ seq: m.seq, id: m.id, to: m.to, replyTo: m.replyTo, text: m.text, sentTick: m.sentTick, status: m.status, decidedTick: m.decidedTick })) : [],
  };
}

export function instructorView(s: SessionState): InstructorView {
  return {
    ...common(s),
    seats: s.seats.map((x) => ({ id: x.id, name: x.name, role: x.role })),
    messages: s.messages.map((m) => ({ ...m })),
    revealed: [...s.revealed],
    secrets: s.exercise.roles.filter((r) => r.secret).map((r) => ({ role: r.id, secret: r.secret! })),
    waitingFor: s.phase === "running" ? playedRoles(s).filter((r) => !s.done.includes(r)) : [],
  };
}
