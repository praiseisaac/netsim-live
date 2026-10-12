// The exercises the live server can run. Add one here and start the server with
// `npm start -- --exercise <id>`; the engine (engine.ts) and the pages don't change. README.md
// ("Add an exercise") walks through the fields.
import type { ExerciseDef } from "./engine";

/** Week 2, step 2: the bus, the clock, two CPUs, memory and a button, acted out. */
export const WEEK_02_ACT_IT_OUT: ExerciseDef = {
  id: "week-02-act-it-out",
  week: 2,
  title: "Act it out: the bus and the clock",
  summary:
    "Four of you play the parts of a tiny computer. The instructor is the bus and the clock. Everyone else watches the timeline and notes what goes wrong.",
  instructor: "the bus and the clock",
  roles: [
    { id: "cpu-1", label: "CPU-1", job: "Ask memory for bytes. React when the button presses.", idPrefix: "c1-" },
    { id: "cpu-2", label: "CPU-2", job: "Ask memory for bytes, including one it doesn't have (address 9).", idPrefix: "c2-" },
    {
      id: "memory",
      label: "MEMORY",
      job: "Answer every read with the byte at that address, or a fault. You only have addresses 0 to 3.",
      idPrefix: "m-",
      secret: "Your bytes: address 0 = 5, address 1 = 12, address 2 = 42, address 3 = 7.",
    },
    { id: "button", label: "BUTTON", job: "Press once, in the middle of a tick: send irq to CPU-1.", idPrefix: "b-" },
  ],
  rules: [
    "Nobody acts between ticks: you only send after the bus starts a tick.",
    "Nobody talks to anyone but the bus. Every message goes to the bus, and the bus delivers it.",
    "Every message gets an id. A reply says which id it answers (replyTo).",
    "When you've done your part for the tick, press Done. The next tick starts only when everyone has.",
  ],
  examples: [
    "CPU-1  → bus:  id=c1-1 to=memory mem.read 2",
    "MEMORY → bus:  id=m-1 replyTo=c1-1 mem.data 42",
    "CPU-2  → bus:  id=c2-1 to=memory mem.read 9",
    "MEMORY → bus:  id=m-2 replyTo=c2-1 fault OUT_OF_RANGE",
    "BUTTON → bus:  id=b-1 to=cpu-1 irq",
  ],
  questions: ["Who owns time?", "What does the bus know about CPUs?", "What should happen at address 9?"],
  glossary: ["tick", "replyTo", "fault", "envelope"],
  // NetSim week 2's messages, and who sends each.
  messages: [
    {
      kind: "mem.read",
      hint: "Ask MEMORY for the byte at an address.",
      from: ["cpu-1", "cpu-2"],
      to: ["memory"],
      // Up to 15, past MEMORY's 0 to 3: CPU-2 is meant to ask for one it doesn't have (address 9).
      arg: { name: "address", kind: "number", min: 0, max: 15, hint: "Which byte to read. MEMORY only has addresses 0 to 3: see what happens if you ask for another." },
    },
    {
      kind: "mem.data",
      hint: "Answer a read with the byte at that address.",
      from: ["memory"],
      to: "reply",
      answers: ["mem.read"],
      arg: { name: "value", kind: "number", min: 0, max: 255, hint: "The byte at the address you were asked for, from your private list (0 to 255)." },
    },
    {
      kind: "fault",
      hint: "Answer a read you can't do: the address isn't one you have.",
      from: ["memory"],
      to: "reply",
      answers: ["mem.read"],
      arg: { name: "reason", kind: "choice", options: ["OUT_OF_RANGE"], hint: "Why the read failed. OUT_OF_RANGE: there's no byte at that address." },
    },
    { kind: "irq", hint: "Press the button: tell CPU-1 something happened.", from: ["button"], to: ["cpu-1"] },
  ],
  fields: {
    id: "Your ticket number for this message. The page fills in the next one; every message needs a new one.",
    kind: "What you're saying. Only the messages your part sends are listed.",
    to: "Which part the bus should deliver it to.",
    replyTo: "The id of the message you're answering, from your inbox. Your answer goes back to whoever sent it.",
  },
};

export const EXERCISES: Record<string, ExerciseDef> = {
  [WEEK_02_ACT_IT_OUT.id]: WEEK_02_ACT_IT_OUT,
};
