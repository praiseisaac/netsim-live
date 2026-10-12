// Shared by the student and instructor pages. Every piece of text from the server goes into the
// page as text (textContent), never as HTML.
"use strict";
/* eslint-disable @typescript-eslint/no-unused-vars -- the helpers student.js and instructor.js use */

/** Make an element: h("li", { class: "x" }, "text", child, …). Strings become text nodes. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Replace an element's children. */
function fill(el, ...children) {
  el.replaceChildren();
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

const store = {
  get(key) {
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private window: the seat lasts as long as the tab */
    }
  },
  drop(key) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* nothing kept */
    }
  },
};

/** POST JSON with a token header; resolves with { ok, status, body }. */
async function post(url, headers, body) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty */
    }
    return { ok: res.ok, status: res.status, body: data };
  } catch {
    return { ok: false, status: 0, body: { error: "Can't reach the server. Check your connection." } };
  }
}

/**
 * Follow a server-sent event stream that needs a token header (EventSource can't send one), and
 * reconnect when it drops. onStatus("live" | "offline" | "gone").
 */
function follow(url, headers, onData, onStatus) {
  let stopped = false;
  let wait = 1000;
  (async function loop() {
    while (!stopped) {
      try {
        const res = await fetch(url, { headers, cache: "no-store" });
        if (res.status === 401 || res.status === 404) {
          onStatus("gone");
          return;
        }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        onStatus("live");
        wait = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const data = chunk
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("\n");
            if (data) onData(JSON.parse(data));
          }
        }
      } catch {
        /* dropped: try again */
      }
      if (stopped) return;
      onStatus("offline");
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 10000);
    }
  })();
  return () => {
    stopped = true;
  };
}

/** A role's label from its id. */
function labelOf(view, id) {
  if (!id) return "watcher";
  const role = view.exercise.roles.find((r) => r.id === id);
  return role ? role.label : id;
}

/** One message as the act-it-out writes it: "CPU-1 → bus: id=c1-1 to=memory mem.read 2". */
function messageText(view, m) {
  return `${labelOf(view, m.from)} → bus: id=${m.id} ${m.replyTo ? `replyTo=${m.replyTo}` : `to=${m.to}`} ${m.text}`;
}

/** The shared timeline, newest at the bottom. */
function renderTimeline(el, view) {
  const items = view.timeline.map((item) => {
    if (item.kind === "tick")
      return h("li", { class: "tl-tick" }, `— tick ${item.tick} —`, item.forced ? h("span", { class: "muted" }, ` (started before ${item.notDone.map((r) => labelOf(view, r)).join(", ")} sent done)`) : null);
    if (item.kind === "end") return h("li", { class: "tl-tick" }, "— the session has ended —");
    const m = item.message;
    return h(
      "li",
      { class: `tl-msg ${m.status}` },
      h("span", { class: `badge b-${m.status}` }, m.status),
      h("code", {}, messageText(view, m)),
      h("span", { class: "muted" }, m.status === "delivered" ? ` delivered to ${labelOf(view, m.to)}` : ` dropped; ${labelOf(view, m.to)} never got it`),
      m.replyToUnknown ? h("span", { class: "warn" }, ` replyTo ${m.replyTo} names no message sent before it`) : null,
    );
  });
  fill(el, items.length ? items : h("li", { class: "muted" }, "Nothing yet. The timeline fills in as the bus delivers."));
  el.scrollTop = el.scrollHeight;
}

function renderNotes(el, view) {
  const items = view.notes.map((n) => h("li", {}, h("b", {}, n.name), h("span", { class: "muted" }, ` (tick ${n.tick}, ${labelOf(view, n.role)}) `), n.text));
  fill(el, items.length ? items : h("li", { class: "muted" }, "No notes yet."));
  el.scrollTop = el.scrollHeight;
}

function renderCast(el, view) {
  fill(
    el,
    view.cast.map((c) => h("li", { class: c.done ? "done" : "" }, h("b", {}, labelOf(view, c.role)), " ", c.name ? c.name : h("span", { class: "muted" }, "nobody yet"), view.phase === "running" && c.name ? h("span", { class: "chip" }, c.done ? "done ✓" : "working") : null)),
    h("li", { class: "muted" }, `${view.watchers} watching`),
  );
}

function renderRules(el, view) {
  fill(el, h("ul", {}, view.exercise.rules.map((r) => h("li", {}, r))), h("pre", {}, h("code", {}, view.exercise.examples.join("\n"))), h("p", { class: "muted" }, "Afterwards: ", view.exercise.questions.join(" ")));
}

function phaseText(view) {
  if (view.phase === "lobby") return "Waiting for tick 1";
  if (view.phase === "ended") return `Ended after tick ${view.tick}`;
  return `Tick ${view.tick}`;
}

// The machine, drawn: the parts around the bus, the clock, who's done, what's waiting at the bus,
// and each message the bus delivers (or drops) moving along it. Flat 2D SVG, like the board. It
// draws only what this person's view already has: a student's own messages waiting at the bus
// (never anyone else's), and what the bus delivered or dropped, which the timeline shows everyone.
const SVG_NS = "http://www.w3.org/2000/svg";
const VIZ = { w: 640, h: 420, busY: 210, partW: 200, partH: 84, topY: 24, bottomY: 312 };

/** Make an SVG element: s("rect", { x: 1 }, child, "text"). */
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) if (value !== null && value !== undefined && value !== false) el.setAttribute(key, String(value));
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Where each part sits: the first half along the top, the rest along the bottom. */
function vizLayout(roles) {
  const top = roles.slice(0, Math.ceil(roles.length / 2));
  const bottom = roles.slice(top.length);
  // Spread each row edge to edge (one part alone sits in the middle).
  const span = VIZ.w - 2 * 24 - VIZ.partW;
  const place = (row, y) => row.map((r, i) => [r.id, { x: 24 + VIZ.partW / 2 + (row.length === 1 ? span / 2 : (span * i) / (row.length - 1)), y, top: y === VIZ.topY }]);
  return Object.fromEntries([...place(top, VIZ.topY), ...place(bottom, VIZ.bottomY)]);
}

/** The point where a part meets the bus, and the edge of the part facing it. */
function stub(at) {
  const edge = at.top ? at.y + VIZ.partH : at.y;
  return { x: at.x, edge, bus: VIZ.busY };
}

function createViz(svg) {
  const state = { seen: null, layout: null, restarts: null };
  svg.setAttribute("viewBox", `0 0 ${VIZ.w} ${VIZ.h}`);
  svg.setAttribute("role", "img");
  const still = s("g", {});
  const fly = s("g", {});
  svg.replaceChildren(s("title", {}, "The parts around the bus"), still, fly);

  /** A message moving from its sender along the bus: on to its target, or fading out in red. */
  function launch(m) {
    const a = state.layout[m.from];
    const b = state.layout[m.to];
    if (!a || !b) return;
    const from = stub(a);
    const to = stub(b);
    const delivered = m.status === "delivered";
    const path = delivered ? `M${from.x},${from.edge} L${from.x},${from.bus} L${to.x},${to.bus} L${to.x},${to.edge}` : `M${from.x},${from.edge} L${from.x},${from.bus} L${(from.x + to.x) / 2},${to.bus}`;
    const motion = s("animateMotion", { dur: delivered ? "1.4s" : "0.9s", fill: "freeze", begin: "indefinite", path });
    const group = s("g", { class: `viz-fly ${delivered ? "ok" : "bad"}` }, s("rect", { x: -26, y: -11, width: 52, height: 22, rx: 6 }), s("text", { x: 0, y: 4, "text-anchor": "middle" }, short(m.id, 7)), motion);
    let fade = null;
    if (!delivered) {
      fade = s("animate", { attributeName: "opacity", from: 1, to: 0, begin: "indefinite", dur: "0.9s", fill: "freeze" });
      group.append(fade);
    }
    fly.append(group);
    motion.beginElement();
    if (fade) setTimeout(() => fade.beginElement(), 900);
    setTimeout(() => group.remove(), delivered ? 2200 : 2000);
  }

  /**
   * Draw the view. `me`: the role to mark as "you" (or null). `waiting`: the messages to show at
   * the bus (a student's own pending ones; the instructor's, all of them).
   */
  return function draw(view, me, waiting) {
    const roles = view.exercise.roles;
    state.layout = vizLayout(roles);
    const cast = Object.fromEntries(view.cast.map((c) => [c.role, c]));
    const parts = roles.map((r) => {
      const at = state.layout[r.id];
      const c = cast[r.id] || {};
      const st = !c.name ? "empty" : view.phase !== "running" ? "idle" : c.done ? "done" : "working";
      const label = { empty: "nobody yet", idle: "", done: "done ✓", working: "working" }[st];
      const x = at.x - VIZ.partW / 2;
      const st2 = stub(at);
      return s(
        "g",
        { class: `viz-part ${st}${r.id === me ? " me" : ""}` },
        s("line", { class: "viz-stub", x1: at.x, y1: st2.edge, x2: at.x, y2: st2.bus }),
        s("rect", { class: "viz-box", x, y: at.y, width: VIZ.partW, height: VIZ.partH, rx: 10 }),
        s("text", { class: "viz-label", x: x + 16, y: at.y + 30 }, r.label),
        s("text", { class: "viz-name", x: x + 16, y: at.y + 54 }, c.name ? short(c.name, 18) : "—"),
        label ? s("text", { class: "viz-state", x: x + 16, y: at.y + 74 }, label) : null,
        r.id === me ? s("g", { class: "viz-you" }, s("rect", { x: x + VIZ.partW - 50, y: at.y - 11, width: 44, height: 22, rx: 11 }), s("text", { x: x + VIZ.partW - 28, y: at.y + 4, "text-anchor": "middle" }, "you")) : null,
      );
    });
    const tickText = view.phase === "lobby" ? "waiting" : view.phase === "ended" ? "ended" : `tick ${view.tick}`;
    const queue = waiting.slice(0, 5).map((m, i) => {
      const x = VIZ.w / 2 - ((Math.min(waiting.length, 5) - 1) * 60) / 2 + i * 60;
      return s("g", { class: "viz-wait" }, s("rect", { x: x - 27, y: VIZ.busY - 34, width: 54, height: 22, rx: 6 }), s("text", { x, y: VIZ.busY - 19, "text-anchor": "middle" }, short(m.id, 7)));
    });
    still.replaceChildren(
      s("rect", { class: "viz-bus", x: 24, y: VIZ.busY - 9, width: VIZ.w - 48, height: 18, rx: 9 }),
      // Between the parts' lines: "BUS · instructor" on the left, the clock right of the middle.
      s("text", { class: "viz-bus-label", x: 146, y: VIZ.busY + 38 }, "BUS · instructor"),
      s("g", { class: `viz-clock ${view.phase}` }, s("rect", { x: VIZ.w / 2 + 16, y: VIZ.busY + 18, width: 108, height: 30, rx: 15 }), s("text", { x: VIZ.w / 2 + 70, y: VIZ.busY + 38, "text-anchor": "middle" }, tickText)),
      waiting.length ? s("text", { class: "viz-wait-label", x: VIZ.w - 32, y: VIZ.busY - 40, "text-anchor": "end" }, `${waiting.length} at the bus${waiting.length > 5 ? ` (+${waiting.length - 5})` : ""}`) : null,
      ...queue,
      ...parts,
    );
    // Animate only what's new since the last view (nothing on the first one, or after a reset,
    // whose messages are numbered from 1 again).
    if (state.restarts !== view.restarts) {
      state.restarts = view.restarts;
      state.seen = null;
      fly.replaceChildren();
    }
    const decided = view.timeline.filter((t) => t.kind === "message").map((t) => t.message);
    if (state.seen === null) state.seen = new Set(decided.map((m) => m.seq));
    for (const m of decided) {
      if (state.seen.has(m.seq)) continue;
      state.seen.add(m.seq);
      launch(m);
    }
  };
}
