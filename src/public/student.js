// The student's page: join with a name, then play a role (or watch) for the whole session.
"use strict";

const KEY = "netsim-live-seat";
const $ = (sel) => document.querySelector(sel);
/** A form's field by name (form.id and form.name are the form's own properties). */
const field = (form, name) => form.elements.namedItem(name);
let token = store.get(KEY);
let view = null;
let lastRole = undefined;

function headers() {
  return { "x-seat-token": token };
}

function showJoin(message) {
  $("[data-join]").hidden = false;
  $("[data-room]").hidden = true;
  $("[data-phase]").textContent = "Not joined";
  $("[data-join-error]").textContent = message || "";
}

$("[data-join-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = field(event.target, "name").value;
  const res = await post("/api/join", {}, { name });
  if (!res.ok) {
    $("[data-join-error]").textContent = res.body.error || "Couldn't join.";
    return;
  }
  token = res.body.token;
  store.set(KEY, token);
  start();
});

// The send form: every field guided (the module's fixed messages, picked from lists), checked as
// you go, with what's wrong in red; Send stays off until the message is right. The server checks
// it all again (engine.ts checkFixed), so this is only for the person typing.
const form = $("[data-send]");
let toChanged = false;

const roleOfMe = (v) => v.exercise.roles.find((r) => r.id === v.me.role);
const defOf = (v, kind) => (v.exercise.messages || []).find((d) => d.kind === kind);
const labelList = (v, ids) => ids.map((id) => labelOf(v, id)).join(" or ");
const kindOf = (text) => String(text).split(" ")[0];

/** The messages in my inbox this message type can answer, still unanswered, newest first. */
function answerable(v, def) {
  const answered = new Set(v.sent.filter((m) => m.replyTo).map((m) => m.replyTo.toLowerCase()));
  return v.inbox.filter((m) => (!def.answers || def.answers.includes(kindOf(m.text))) && !answered.has(m.id.toLowerCase())).reverse();
}

/** What's wrong with each field (engine.ts checkFixed, for the page), and where the message goes. */
function check(v, values) {
  const errors = {};
  const role = roleOfMe(v);
  const prefix = role.idPrefix;
  const id = values.id.trim();
  if (!id) errors.id = `Give it an id, like ${prefix}1.`;
  else if (!id.toLowerCase().startsWith(prefix.toLowerCase()) || !/^\d+$/.test(id.slice(prefix.length))) errors.id = `${role.label}'s ids are ${prefix} and a number, like ${prefix}1, ${prefix}2.`;
  else if (v.sent.some((m) => m.id.toLowerCase() === id.toLowerCase()) || v.inbox.some((m) => m.id.toLowerCase() === id.toLowerCase())) errors.id = `${id} is already used: take the next number.`;
  const def = defOf(v, values.kind);
  let to = values.to;
  if (!def) errors.kind = "Pick a message.";
  else {
    if (def.to === "reply") {
      const asked = v.inbox.find((m) => m.id === values.replyTo);
      if (!values.replyTo) errors.replyTo = answerable(v, def).length ? `${def.kind} is an answer: pick the message it answers.` : `Nothing in your inbox to answer with ${def.kind} yet.`;
      else if (!asked) errors.replyTo = `${values.replyTo} isn't a message the bus delivered to you.`;
      else to = asked.from;
    } else if (!to) errors.to = `Pick who it's for: ${def.kind} goes to ${labelList(v, def.to)}.`;
    else if (!def.to.includes(to)) errors.to = `${def.kind} goes to ${labelList(v, def.to)}, not ${labelOf(v, to)}.`;
    const a = def.arg;
    if (a && a.kind === "number" && !(values.arg !== "" && Number(values.arg) >= a.min && Number(values.arg) <= a.max)) errors.arg = `Pick the ${a.name} (${a.min} to ${a.max}).`;
    if (a && a.kind === "choice" && !a.options.includes(values.arg)) errors.arg = `Pick the ${a.name}.`;
  }
  return { errors, to, def };
}

function values() {
  return { kind: field(form, "kind").value, arg: field(form, "arg").value, replyTo: field(form, "replyTo").value, to: field(form, "to").value, id: field(form, "id").value };
}

/** Fill the fields that depend on the message type, keeping what the person already picked. */
function shapeForm(v) {
  const def = defOf(v, field(form, "kind").value);
  const role = roleOfMe(v);
  const f = v.exercise.fields || {};
  const hint = (name, text) => ($(`[data-hint="${name}"]`).textContent = text || "");
  hint("kind", def ? `${def.hint} ${f.kind || ""}` : f.kind);
  hint("id", `${f.id || ""} Yours: ${role.idPrefix}1, ${role.idPrefix}2, …`);
  hint("replyTo", f.replyTo);
  hint("to", f.to);

  const argField = $("[data-arg-field]");
  argField.hidden = !(def && def.arg);
  if (def && def.arg) {
    const a = def.arg;
    $("[data-arg-name]").textContent = a.name;
    hint("arg", a.hint);
    const sel = field(form, "arg");
    const want = sel.dataset.for === def.kind ? sel.value : "";
    const options = a.kind === "number" ? Array.from({ length: a.max - a.min + 1 }, (_, i) => String(a.min + i)) : a.options;
    if (sel.dataset.for !== def.kind) {
      fill(sel, h("option", { value: "" }, `pick the ${a.name}`), options.map((o) => h("option", { value: o }, o)));
      sel.dataset.for = def.kind;
      if (options.length === 1) sel.value = options[0];
    } else sel.value = want;
  }

  const replyField = $("[data-reply-field]");
  const isReply = !!def && def.to === "reply";
  replyField.hidden = !isReply;
  const rsel = field(form, "replyTo");
  if (isReply) {
    const keep = rsel.value;
    const choices = answerable(v, def);
    fill(rsel, h("option", { value: "" }, choices.length ? "pick the message you're answering" : "nothing to answer yet"), choices.map((m) => h("option", { value: m.id }, `${m.id} · ${labelOf(v, m.from)}: ${m.text}`)));
    rsel.value = choices.some((m) => m.id === keep) ? keep : choices.length === 1 ? choices[0].id : "";
  } else rsel.value = "";

  // "to": worked out from the message (and the message it answers); "change" shows the picker.
  const tsel = field(form, "to");
  if (!isReply && def && !toChanged) tsel.value = def.to.length === 1 ? def.to[0] : "";
  tsel.hidden = isReply || !toChanged;
  const asked = isReply ? v.inbox.find((m) => m.id === rsel.value) : null;
  const goes = !def ? "pick a message first" : isReply ? (asked ? labelOf(v, asked.from) : "whoever sent the message you answer") : tsel.value ? labelOf(v, tsel.value) : "pick a part";
  fill(
    $("[data-to-text]"),
    "goes to: ",
    h("b", {}, goes),
    !isReply && def && !toChanged ? h("button", { type: "button", class: "linkbtn", onclick: () => ((toChanged = true), validate()) }, "change") : null,
  );
}

/** Show each field's problem in red, the message as it will read, and Send only when it's right. */
function validate() {
  if (!view || !roleOfMe(view)) return;
  shapeForm(view);
  const vals = values();
  const { errors, to, def } = check(view, vals);
  for (const name of ["kind", "arg", "replyTo", "to", "id"]) {
    const el = $(`[data-err="${name}"]`);
    // An untouched form shows no red until something's been picked.
    const show = form.dataset.touched === "1" && errors[name];
    el.textContent = show ? errors[name] : "";
    el.closest(".field").classList.toggle("bad", !!show);
  }
  const ok = Object.keys(errors).length === 0;
  $("[data-preview]").textContent = def ? `id=${vals.id || "?"} ${def.to === "reply" ? `replyTo=${vals.replyTo || "?"}` : `to=${to || "?"}`} ${def.kind}${def.arg ? ` ${vals.arg || "?"}` : ""}` : "pick a message";
  $("[data-send-btn]").disabled = !ok || !view.me.canAct;
}

form.addEventListener("change", (event) => {
  form.dataset.touched = "1";
  if (event.target.name === "kind") toChanged = false;
  validate();
});
form.addEventListener("input", () => {
  form.dataset.touched = "1";
  validate();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  form.dataset.touched = "1";
  const vals = values();
  const { errors, to } = check(view, vals);
  if (Object.keys(errors).length) return validate();
  const res = await post("/api/act", headers(), { type: "send", id: vals.id, kind: vals.kind, arg: vals.arg, replyTo: vals.replyTo, to });
  $("[data-send-error]").textContent = res.ok ? "" : res.body.error || "Not sent.";
  if (res.ok) {
    field(form, "kind").value = "";
    field(form, "replyTo").value = "";
    field(form, "arg").dataset.for = "";
    toChanged = false;
    form.dataset.touched = "";
  }
});

$("[data-done]").addEventListener("click", async () => {
  const res = await post("/api/act", headers(), { type: "done" });
  $("[data-send-error]").textContent = res.ok ? "" : res.body.error || "Not sent.";
});

$("[data-note]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.target;
  const res = await post("/api/act", headers(), { type: "note", text: field(f, "text").value });
  $("[data-note-error]").textContent = res.ok ? "" : res.body.error || "Not posted.";
  if (res.ok) field(f, "text").value = "";
});

/** The next id this role would use: its prefix and one more than the highest it has sent. */
function nextId(v) {
  const role = v.exercise.roles.find((r) => r.id === v.me.role);
  if (!role) return "";
  let n = 0;
  for (const m of v.sent) {
    const match = m.id.startsWith(role.idPrefix) ? /^(\d+)$/.exec(m.id.slice(role.idPrefix.length)) : null;
    if (match) n = Math.max(n, Number(match[1]));
  }
  return role.idPrefix + (n + 1);
}

/** The restart count when this page first saw the session, so a later restart shows a note. */
let firstRestarts = null;

function render(v) {
  view = v;
  if (firstRestarts === null) firstRestarts = v.restarts;
  if (v.restarts > firstRestarts && v.restarts !== render.restarts) {
    // The instructor reset the exercise: drop what was half-filled in the send form.
    field(form, "kind").value = "";
    field(form, "replyTo").value = "";
    field(form, "arg").dataset.for = "";
    form.dataset.touched = "";
    $("[data-send-error]").textContent = "";
  }
  render.restarts = v.restarts;
  $("[data-join]").hidden = true;
  $("[data-room]").hidden = false;
  $("[data-title]").textContent = v.exercise.title;
  $("[data-phase]").textContent = phaseText(v);
  const me = v.me;
  const role = v.exercise.roles.find((r) => r.id === me.role);
  fill(
    $("[data-me]"),
    v.restarts > firstRestarts && v.phase === "lobby" ? h("p", { class: "restarted" }, h("b", {}, "The exercise was restarted. "), "Everything so far is cleared; you keep your part. Wait for tick 1.") : null,
    h("p", { class: "eyebrow" }, `You are ${me.name}`),
    h("h2", {}, role ? `You play ${role.label}` : "You're watching"),
    h("p", {}, role ? role.job : "Watch the timeline. When something goes wrong (a reply used too early, an id nobody asked for, a message to the wrong part), post a note."),
    role ? h("p", { class: "muted" }, `Number your ids ${role.idPrefix}1, ${role.idPrefix}2, … The instructor is ${v.exercise.instructor}.`) : null,
    me.secret ? h("p", { class: "secret" }, h("b", {}, "Only you can see this: "), me.secret) : null,
    role && !me.canAct ? h("p", { class: "wait" }, me.why) : null,
  );

  const sendCard = $("[data-send-card]");
  sendCard.hidden = !role;
  $("[data-inbox-card]").hidden = !role;
  if (role) {
    const f = form;
    if (lastRole !== me.role) {
      // A new role: its own messages, the "to" list without itself, and a fresh id.
      const mine = (v.exercise.messages || []).filter((d) => d.from.includes(me.role));
      fill(field(f, "kind"), h("option", { value: "" }, "pick a message"), mine.map((d) => h("option", { value: d.kind }, d.kind)));
      if (mine.length === 1) field(f, "kind").value = mine[0].kind;
      fill(field(f, "to"), h("option", { value: "" }, "pick a part"), v.exercise.roles.filter((r) => r.id !== me.role).map((r) => h("option", { value: r.id }, r.label)));
      field(f, "id").value = "";
      toChanged = false;
    }
    const suggested = nextId(v);
    if (!field(f, "id").value || field(f, "id").dataset.auto === field(f, "id").value) {
      field(f, "id").value = suggested;
      field(f, "id").dataset.auto = suggested;
    }
    for (const el of f.querySelectorAll("input, select, button")) el.disabled = !me.canAct;
    fill($("[data-inbox]"), v.inbox.length ? v.inbox.map((m) => h("li", {}, h("span", { class: "muted" }, `tick ${m.decidedTick} `), h("code", {}, messageText(v, m)))) : h("li", { class: "muted" }, "Nothing delivered to you yet."));
    fill(
      $("[data-sent]"),
      v.sent.length
        ? v.sent.map((m) => h("li", {}, h("span", { class: `badge b-${m.status}` }, m.status === "pending" ? "at the bus" : m.status), h("code", {}, `id=${m.id} ${m.replyTo ? `replyTo=${m.replyTo}` : `to=${m.to}`} ${m.text}`)))
        : h("li", { class: "muted" }, "Nothing sent yet."),
    );
  }
  lastRole = me.role;
  if (role) validate();
  drawViz(v, me.role, v.sent.filter((m) => m.status === "pending"));
  renderTimeline($("[data-timeline]"), v);
  renderNotes($("[data-notes]"), v);
  renderCast($("[data-cast]"), v);
  renderRules($("[data-rules]"), v);
  for (const el of $("[data-note]").querySelectorAll("input, button")) el.disabled = v.phase === "ended";
}

const drawViz = createViz($("[data-viz]"));

let stop = null;
function start() {
  if (stop) stop();
  stop = follow("/api/stream", headers(), render, (status) => {
    if (status === "gone") {
      store.drop(KEY);
      token = null;
      if (stop) stop();
      showJoin(view ? "Your seat is gone: the instructor cleared the class or removed you, or the server restarted. Join again." : "");
      return;
    }
    $("[data-conn]").textContent = status === "live" ? "" : "Reconnecting…";
  });
}

if (token) start();
else showJoin();
