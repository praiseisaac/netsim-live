// The instructor's page: the clock, the bus, the roles, and End and export.
"use strict";

const $ = (sel) => document.querySelector(sel);
const KEY = "netsim-live-teach";

// The token comes in the link's #t=…; keep it for this tab only and take it out of the address bar.
const fromHash = /(?:^#|&)t=([\w-]+)/.exec(location.hash);
if (fromHash) {
  try {
    sessionStorage.setItem(KEY, fromHash[1]);
  } catch {
    /* kept in memory below */
  }
  history.replaceState(null, "", location.pathname);
}
let token = fromHash ? fromHash[1] : null;
if (!token) {
  try {
    token = sessionStorage.getItem(KEY);
  } catch {
    token = null;
  }
}
let view = null;

const headers = () => ({ "x-teach-token": token || "" });

async function act(body) {
  const res = await post("/api/teach/act", headers(), body);
  $("[data-error]").textContent = res.ok ? "" : res.body.error || "That didn't work.";
  return res;
}

$("[data-tick]").addEventListener("click", () => act({ type: "tick" }));
$("[data-force]").addEventListener("click", () => act({ type: "tick", force: true }));
$("[data-auto]").addEventListener("click", () => act({ type: "auto" }));
$("[data-lock]").addEventListener("change", (event) => act({ type: "lock", locked: event.target.checked }));
$("[data-end]").addEventListener("click", async () => {
  if (view && view.phase !== "ended" && !confirm("End the session for everyone and write the export?")) return;
  const res = await act({ type: "end" });
  if (res.ok && res.body.value) showExported(res.body.value);
});

for (const button of document.querySelectorAll("[data-reset]")) {
  button.addEventListener("click", async () => {
    const clear = button.dataset.reset === "clear";
    const question = clear
      ? "Clear everyone? The exercise starts again, and everyone is removed: they join again from the link."
      : "Restart the exercise? Messages, the timeline, notes, done and reveals are cleared. Everyone keeps their role.";
    if (!confirm(question)) return;
    const res = await act({ type: "reset", clear });
    if (res.ok) fill($("[data-exported]"));
  });
}

function showExported(paths) {
  fill($("[data-exported]"), "Written: ", h("code", {}, paths.html), " and ", h("code", {}, paths.json), ", in the exports folder. Open the replay in any browser, or share the folder.");
}

const drawViz = createViz($("[data-viz]"));

function render(v) {
  view = v;
  $("[data-room]").hidden = false;
  $("[data-title]").textContent = v.exercise.title;
  $("[data-phase]").textContent = phaseText(v);
  $("[data-live-url]").textContent = v.liveUrl;

  // The clock.
  const tickBtn = $("[data-tick]");
  tickBtn.textContent = v.phase === "lobby" ? "Start tick 1" : `Start tick ${v.tick + 1}`;
  tickBtn.disabled = v.phase === "ended" || v.waitingFor.length > 0;
  $("[data-force]").hidden = !(v.phase === "running" && v.waitingFor.length > 0);
  $("[data-waiting]").textContent =
    v.phase === "lobby" ? "Give out the roles, reveal MEMORY's bytes, then start tick 1." : v.phase === "ended" ? "The session has ended." : v.waitingFor.length ? `Tick ${v.tick}: waiting for done from ${v.waitingFor.map((r) => labelOf(v, r)).join(", ")}.` : `Tick ${v.tick}: everyone is done.`;

  // The bus queue.
  const pending = v.messages.filter((m) => m.status === "pending");
  fill(
    $("[data-queue]"),
    pending.length
      ? pending.map((m) =>
          h(
            "li",
            { class: "queued" },
            h("span", { class: "muted" }, `tick ${m.sentTick} `),
            h("code", {}, messageText(v, m)),
            h("span", { class: "muted" }, ` for ${labelOf(v, m.to)}`),
            m.replyToUnknown ? h("span", { class: "warn" }, ` replyTo ${m.replyTo} names no message`) : null,
            h("span", { class: "row inline" }, h("button", { class: "btn primary small", onclick: () => act({ type: "deliver", seq: m.seq }), disabled: v.phase !== "running" }, "Deliver"), h("button", { class: "btn small", onclick: () => act({ type: "drop", seq: m.seq }), disabled: v.phase !== "running" }, "Drop")),
          ),
        )
      : h("li", { class: "muted" }, "Nothing waiting."),
  );

  // The class: give out roles, remove someone.
  $("[data-lock]").checked = !!v.locked;
  $("[data-auto]").disabled = v.phase === "ended";
  fill(
    $("[data-seats]"),
    v.seats.length
      ? v.seats.map((s) =>
          h(
            "li",
            { class: "seat" },
            h("b", {}, s.name),
            h(
              "select",
              { "aria-label": `Role for ${s.name}`, disabled: v.phase === "ended", onchange: (e) => act({ type: "assign", seat: s.id, role: e.target.value }) },
              h("option", { value: "", selected: s.role === null }, "watcher"),
              v.exercise.roles.map((r) => h("option", { value: r.id, selected: s.role === r.id }, r.label)),
            ),
            h("button", { class: "btn small ghost", onclick: () => confirm(`Remove ${s.name} from the class?`) && act({ type: "kick", seat: s.id }) }, "Remove"),
          ),
        )
      : h("li", { class: "muted" }, "Nobody has joined yet. Share the students' link."),
  );

  fill(
    $("[data-secrets]"),
    v.secrets.map((s) =>
      h("li", {}, h("b", {}, labelOf(v, s.role)), ": ", s.secret, " ", v.revealed.includes(s.role) ? h("span", { class: "chip" }, "shown to them ✓") : h("button", { class: "btn small", onclick: () => act({ type: "reveal", role: s.role }) }, `Show ${labelOf(v, s.role)} only`)),
    ),
  );
  renderCast($("[data-cast]"), v);
  renderTimeline($("[data-timeline]"), v);
  renderNotes($("[data-notes]"), v);
  fill(
    $("[data-messages]"),
    v.messages.length
      ? v.messages.map((m) => h("tr", {}, h("td", {}, String(m.seq)), h("td", {}, `tick ${m.sentTick}`), h("td", {}, h("code", {}, messageText(v, m))), h("td", {}, labelOf(v, m.to)), h("td", {}, h("span", { class: `badge b-${m.status}` }, m.status), m.decidedTick ? ` tick ${m.decidedTick}` : "")))
      : h("tr", {}, h("td", { colspan: "5", class: "muted" }, "No messages yet.")),
  );
  renderRules($("[data-rules]"), v);
  drawViz(v, null, v.messages.filter((m) => m.status === "pending"));
  $("[data-end]").textContent = v.phase === "ended" ? (v.exported ? "Exported" : "Export again") : "End and export";
  $("[data-end]").disabled = !!v.exported;
  if (v.exported) showExported(v.exported);
}

if (!token) {
  $("[data-denied]").hidden = false;
  $("[data-phase]").textContent = "No token";
} else {
  follow("/api/teach/stream", headers(), render, (status) => {
    if (status === "gone") {
      $("[data-denied]").hidden = false;
      $("[data-room]").hidden = true;
      $("[data-phase]").textContent = "Not allowed";
      return;
    }
    $("[data-conn]").textContent = status === "live" ? "" : "Reconnecting…";
  });
}
