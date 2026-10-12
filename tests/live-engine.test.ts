// The live in-class exercise's state machine (src/engine.ts): ticks, done, delivery, ids,
// and what each person may see.
import { describe, expect, it } from "vitest";
import * as e from "../src/engine";
import { WEEK_02_ACT_IT_OUT } from "../src/exercises";

/** Week 2 without its fixed messages: a message is free text (the engine's other mode). */
const FREE: e.ExerciseDef = { ...WEEK_02_ACT_IT_OUT, messages: undefined, fields: undefined };

/** A session with the four roles cast and one watcher. */
function cast(exercise: e.ExerciseDef = WEEK_02_ACT_IT_OUT) {
  const s = e.createSession(exercise);
  const names: Record<string, string> = { cpu1: "Tobi", cpu2: "Amara", mem: "Kemi", btn: "Femi", watch: "Zara" };
  for (const [seat, name] of Object.entries(names)) expect(e.join(s, seat, name, 1).ok).toBe(true);
  e.assign(s, "cpu1", "cpu-1", 2);
  e.assign(s, "cpu2", "cpu-2", 2);
  e.assign(s, "mem", "memory", 2);
  e.assign(s, "btn", "button", 2);
  return s;
}

const error = (r: e.Result<unknown>) => (r.ok ? "" : r.error);

describe("joining and roles", () => {
  it("cleans names, keeps them unique, and caps the class", () => {
    const s = e.createSession(WEEK_02_ACT_IT_OUT);
    expect(e.join(s, "a", "  Ada\n‮Lovelace  ", 0)).toMatchObject({ ok: true, value: { name: "Ada Lovelace", role: null } });
    expect(e.join(s, "b", "ada lovelace", 0)).toMatchObject({ ok: true, value: { name: "ada lovelace (2)" } });
    expect(error(e.join(s, "c", "   ", 0))).toMatch(/name/);
    expect(e.join(s, "d", "x".repeat(100), 0)).toMatchObject({ ok: true, value: { name: "x".repeat(e.LIMITS.name) } });
    for (let i = s.seats.length; i < e.LIMITS.seats; i++) e.join(s, `s${i}`, `p${i}`, 0);
    expect(error(e.join(s, "late", "Late", 0))).toMatch(/full/);
  });

  it("gives a role to one seat at a time, and fills empty roles first come first", () => {
    const s = e.createSession(WEEK_02_ACT_IT_OUT);
    for (const seat of ["a", "b", "c", "d", "f"]) e.join(s, seat, seat, 0);
    e.assign(s, "a", "memory", 0);
    e.assign(s, "b", "memory", 0);
    expect(e.seatOf(s, "a")!.role).toBeNull();
    expect(e.seatOf(s, "b")!.role).toBe("memory");
    expect(error(e.assign(s, "a", "printer", 0))).toMatch(/role/);
    e.autoAssign(s, 0);
    expect(s.seats.map((x) => x.role)).toEqual(["cpu-1", "memory", "cpu-2", "button", null]);
  });

  it("frees a removed seat's role", () => {
    const s = cast();
    expect(e.removeSeat(s, "mem", 3).ok).toBe(true);
    expect(e.playedRoles(s)).toEqual(["cpu-1", "cpu-2", "button"]);
    expect(e.studentView(s, "mem")).toBeNull();
  });
});

describe("the clock", () => {
  it("lets nobody act before tick 1", () => {
    const s = cast();
    expect(error(e.send(s, "cpu1", { id: "c1-1", to: "memory", text: "mem.read 2" }, 3))).toMatch(/tick 1/);
    expect(error(e.done(s, "cpu1", 3))).toMatch(/tick 1/);
  });

  it("waits for done from every played role, unless forced", () => {
    const s = cast();
    expect(e.tick(s, false, 3)).toEqual({ ok: true, value: 1 });
    expect(s.phase).toBe("running");
    e.done(s, "cpu1", 4);
    e.done(s, "cpu2", 4);
    e.done(s, "btn", 4);
    expect(error(e.tick(s, false, 5))).toBe("Waiting for done from MEMORY.");
    expect(e.instructorView(s).waitingFor).toEqual(["memory"]);
    e.done(s, "mem", 5);
    expect(e.tick(s, false, 6)).toEqual({ ok: true, value: 2 });
    expect(s.done).toEqual([]);
    expect(e.tick(s, true, 7)).toEqual({ ok: true, value: 3 });
    expect(s.log.at(-1)).toMatchObject({ type: "tick", tick: 3, forced: true, notDone: ["cpu-1", "cpu-2", "memory", "button"] });
  });

  it("stops a role from acting after its done, until the next tick", () => {
    const s = cast();
    e.tick(s, false, 3);
    e.done(s, "cpu1", 4);
    expect(error(e.send(s, "cpu1", { id: "c1-1", to: "memory", text: "mem.read 2" }, 5))).toMatch(/done for tick 1/);
    expect(error(e.done(s, "cpu1", 5))).toMatch(/done for tick 1/);
    e.tick(s, true, 6);
    expect(e.send(s, "cpu1", { id: "c1-1", to: "memory", text: "mem.read 2" }, 7).ok).toBe(true);
  });

  it("lets watchers note but not send", () => {
    const s = cast();
    e.tick(s, false, 3);
    expect(error(e.send(s, "watch", { id: "w-1", to: "memory", text: "hi" }, 4))).toMatch(/Watchers/);
    expect(e.note(s, "watch", "CPU-2 used the reply too early", 4)).toMatchObject({ ok: true, value: { name: "Zara", tick: 1 } });
  });
});

describe("messages and the bus", () => {
  it("takes only the module's fixed messages, each field checked, when the exercise has them", () => {
    const s = cast();
    e.tick(s, false, 3);
    const send = (seat: string, input: e.SendInput) => error(e.send(s, seat, input, 4));
    expect(send("cpu1", { id: "x-1", kind: "mem.read", to: "memory", arg: "2" })).toMatch(/CPU-1's ids are c1- and a number/);
    expect(send("cpu1", { id: "c1-1", kind: "irq", to: "cpu-2" })).toMatch(/CPU-1 doesn't send irq/);
    expect(send("cpu1", { id: "c1-1", kind: "hello", to: "memory" })).toMatch(/no message called hello/);
    expect(send("cpu1", { id: "c1-1", kind: "mem.read", to: "button", arg: "2" })).toMatch(/mem.read goes to MEMORY, not BUTTON/);
    expect(send("cpu1", { id: "c1-1", kind: "mem.read", to: "memory", arg: "two" })).toMatch(/address is a whole number from 0 to 15/);
    expect(send("cpu1", { id: "c1-1", kind: "mem.read", to: "memory", arg: "<b>" })).toMatch(/whole number/);
    // Address 9 is allowed: it's how the class meets a fault.
    expect(send("cpu2", { id: "c2-1", kind: "mem.read", to: "memory", arg: "9" })).toBe("");
    expect(send("cpu1", { id: "c1-1", text: "mem.read 2", to: "memory" })).toBe("");
    expect(send("cpu1", { id: "c1-1", kind: "mem.read", to: "memory", arg: "3" })).toMatch(/already used/);
    // An answer needs a replyTo naming a read the bus delivered to you, and goes back to its sender.
    expect(send("mem", { id: "m-1", kind: "mem.data", arg: "42" })).toMatch(/put the id of the message it answers/);
    expect(send("mem", { id: "m-1", kind: "mem.data", replyTo: "c1-2", arg: "42" })).toMatch(/c1-2 isn't a message the bus delivered to you/);
    expect(send("mem", { id: "m-1", kind: "mem.data", replyTo: "c2-1", arg: "42" })).toMatch(/isn't a message the bus delivered/);
    e.decide(s, 1, true, 5);
    e.decide(s, 2, true, 5);
    expect(send("mem", { id: "m-1", kind: "fault", replyTo: "c2-1", arg: "OOPS" })).toMatch(/reason is OUT_OF_RANGE/);
    expect(send("mem", { id: "m-1", kind: "mem.data", replyTo: "c1-1", arg: "300" })).toMatch(/0 to 255/);
    expect(send("mem", { id: "m-1", kind: "fault", replyTo: "c2-1", arg: "OUT_OF_RANGE", to: "button" })).toBe("");
    expect(s.messages.at(-1)).toMatchObject({ to: "cpu-2", replyTo: "c2-1", text: "fault OUT_OF_RANGE", replyToUnknown: false });
    expect(send("btn", { id: "b-1", kind: "irq", to: "cpu-2" })).toMatch(/irq goes to CPU-1/);
    expect(send("btn", { id: "b-1", kind: "irq", to: "cpu-1", arg: "junk" })).toBe("");
    expect(s.messages.at(-1)!.text).toBe("irq");
  });

  it("checks ids, recipients and text (free text)", () => {
    const s = cast(FREE);
    e.tick(s, false, 3);
    const send = (input: Parameters<typeof e.send>[2]) => error(e.send(s, "cpu1", input, 4));
    expect(send({ to: "memory", text: "mem.read 2" })).toMatch(/id/);
    expect(send({ id: "c1 1", to: "memory", text: "x" })).toMatch(/letters, digits/);
    expect(send({ id: "<b>", to: "memory", text: "x" })).toMatch(/letters, digits/);
    expect(send({ id: "c1-1", to: "bus", text: "x" })).toMatch(/who the message is for/);
    expect(send({ id: "c1-1", to: "cpu-1", text: "x" })).toMatch(/yourself/);
    expect(send({ id: "c1-1", to: "memory", text: "  " })).toMatch(/Say what/);
    expect(send({ id: "c1-1", to: "memory", text: "mem.read 2" })).toBe("");
    expect(error(e.send(s, "cpu2", { id: "C1-1", to: "memory", text: "mem.read 9" }, 4))).toMatch(/already used/);
  });

  it("delivers or drops each message once, and flags a replyTo nobody sent (free text)", () => {
    const s = cast(FREE);
    e.tick(s, false, 3);
    e.send(s, "cpu1", { id: "c1-1", to: "memory", text: "mem.read 2" }, 4);
    const reply = e.send(s, "mem", { id: "m-1", to: "cpu-1", replyTo: "c1-1", text: "mem.data 42" }, 5);
    const stray = e.send(s, "mem", { id: "m-2", to: "cpu-2", replyTo: "c2-9", text: "fault OUT_OF_RANGE" }, 5);
    expect(reply).toMatchObject({ ok: true, value: { replyTo: "c1-1", replyToUnknown: false, status: "pending", sentTick: 1 } });
    expect(stray).toMatchObject({ ok: true, value: { replyToUnknown: true } });
    expect(e.decide(s, 1, true, 6).ok).toBe(true);
    expect(error(e.decide(s, 1, false, 6))).toMatch(/already delivered/);
    expect(e.decide(s, 3, false, 6).ok).toBe(true);
    expect(error(e.decide(s, 99, true, 6))).toMatch(/No such/);
    expect(s.messages.map((m) => m.status)).toEqual(["delivered", "pending", "dropped"]);
  });

  it("shows the timeline in order: ticks, deliveries and drops, never what's still at the bus", () => {
    const s = cast();
    e.tick(s, false, 3);
    e.send(s, "cpu1", { id: "c1-1", to: "memory", text: "mem.read 2" }, 4);
    e.send(s, "cpu2", { id: "c2-1", to: "memory", text: "mem.read 9" }, 4);
    e.decide(s, 2, false, 5);
    e.tick(s, true, 6);
    e.decide(s, 1, true, 7);
    expect(e.timeline(s).map((t) => (t.kind === "message" ? `${t.message.id}:${t.message.status}@${t.message.decidedTick}` : `${t.kind}${"tick" in t ? t.tick : ""}`))).toEqual([
      "tick1",
      "c2-1:dropped@1",
      "tick2",
      "c1-1:delivered@2",
    ]);
  });
});

describe("what each person sees", () => {
  it("shows MEMORY its bytes only once revealed, and nobody else ever", () => {
    const s = cast();
    expect(e.studentView(s, "mem")!.me.secret).toBeNull();
    e.reveal(s, "memory", 3);
    expect(e.studentView(s, "mem")!.me.secret).toMatch(/address 2 = 42/);
    for (const seat of ["cpu1", "cpu2", "btn", "watch"]) expect(JSON.stringify(e.studentView(s, seat))).not.toMatch(/= 42/);
    expect(error(e.reveal(s, "cpu-1", 3))).toMatch(/nothing private/);
  });

  it("puts a message in the recipient's inbox only after the bus delivers it", () => {
    const s = cast();
    e.tick(s, false, 3);
    e.send(s, "cpu1", { id: "c1-7", to: "memory", text: "mem.read 2" }, 4);
    expect(e.studentView(s, "mem")!.inbox).toEqual([]);
    expect(e.studentView(s, "cpu1")!.sent).toMatchObject([{ id: "c1-7", status: "pending" }]);
    expect(JSON.stringify(e.studentView(s, "cpu2"))).not.toMatch(/c1-7/);
    e.decide(s, 1, true, 5);
    expect(e.studentView(s, "mem")!.inbox).toMatchObject([{ id: "c1-7", from: "cpu-1", text: "mem.read 2" }]);
    expect(e.studentView(s, "cpu2")!.inbox).toEqual([]);
    expect(e.studentView(s, "cpu1")!.sent).toMatchObject([{ id: "c1-7", status: "delivered", decidedTick: 1 }]);
  });

  it("ends for everyone", () => {
    const s = cast();
    e.tick(s, false, 3);
    expect(e.end(s, 9).ok).toBe(true);
    expect(error(e.end(s, 9))).toMatch(/already/);
    expect(error(e.tick(s, true, 10))).toMatch(/ended/);
    expect(error(e.join(s, "new", "New", 10))).toMatch(/ended/);
    expect(error(e.note(s, "watch", "late", 10))).toMatch(/ended/);
    expect(e.timeline(s).at(-1)).toEqual({ kind: "end", tick: 1 });
  });
});

describe("reset", () => {
  /** A session part-way through: a tick, a delivered read, a note, a reveal, a done. */
  function midway() {
    const s = cast();
    e.reveal(s, "memory", 2);
    e.tick(s, false, 3);
    e.send(s, "cpu1", { id: "c1-1", kind: "mem.read", to: "memory", arg: "2" }, 4);
    e.decide(s, 1, true, 5);
    e.note(s, "watch", "too early", 6);
    e.done(s, "cpu1", 7);
    return s;
  }

  it("restarts the exercise: back to waiting for tick 1, everyone keeps their seat and role", () => {
    const s = midway();
    expect(e.restart(s, false).ok).toBe(true);
    expect(s).toMatchObject({ phase: "lobby", tick: 0, startedAt: null, endedAt: null, messages: [], notes: [], done: [], revealed: [], log: [], restarts: 1 });
    expect(s.seats.map((x) => [x.id, x.role])).toEqual([["cpu1", "cpu-1"], ["cpu2", "cpu-2"], ["mem", "memory"], ["btn", "button"], ["watch", null]]);
    const view = e.studentView(s, "mem")!;
    expect(view).toMatchObject({ restarts: 1, inbox: [], sent: [], timeline: [], me: { role: "memory", secret: null } });
    // The ids start again, and the clock starts at tick 1.
    expect(e.tick(s, false, 8).ok).toBe(true);
    expect(s.tick).toBe(1);
    expect(error(e.send(s, "cpu1", { id: "c1-1", kind: "mem.read", to: "memory", arg: "2" }, 9))).toBe("");
  });

  it("clears everyone, and works after the session has ended", () => {
    const s = midway();
    e.end(s, 8);
    expect(e.restart(s, true).ok).toBe(true);
    expect(s).toMatchObject({ phase: "lobby", seats: [], messages: [], restarts: 1 });
    expect(e.studentView(s, "cpu1")).toBeNull();
    expect(e.join(s, "new", "Tobi", 9).ok).toBe(true);
  });
});
