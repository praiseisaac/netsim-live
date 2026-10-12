// "End and export" (src/export.ts): the record, the replay page and its escaping, the
// week's in-class page, and the file names.
import { describe, expect, it } from "vitest";
import * as e from "../src/engine";
import { WEEK_02_ACT_IT_OUT } from "../src/exercises";
import { escHtml, exportDir, exportName, exportRecord, indexEntry, renderIndex, renderReplay } from "../src/export";
import { buildPage, loadGlossary, loadSnippet } from "../src/glossary";

const EVIL = `<script>alert(1)</script><img src=x onerror=alert(2)>"'&`;
const T0 = Date.UTC(2026, 9, 12, 18, 0, 0);

function played() {
  // Free-text messages, so a hostile one reaches the export too.
  const s = e.createSession({ ...WEEK_02_ACT_IT_OUT, messages: undefined });
  e.join(s, "a", "Tobi", T0);
  e.join(s, "b", EVIL, T0);
  e.join(s, "c", "Zara", T0);
  e.assign(s, "a", "cpu-1", T0);
  e.assign(s, "b", "memory", T0);
  e.reveal(s, "memory", T0);
  e.tick(s, false, T0 + 1000);
  e.send(s, "a", { id: "c1-1", to: "memory", text: `mem.read 2 ${EVIL}` }, T0 + 2000);
  e.decide(s, 1, true, T0 + 3000);
  e.send(s, "b", { id: "m-1", to: "cpu-1", replyTo: "c1-1", text: "mem.data 42" }, T0 + 4000);
  e.send(s, "a", { id: "c1-2", to: "memory", text: "mem.read 3" }, T0 + 4500);
  e.decide(s, 3, false, T0 + 4600);
  e.note(s, "c", `went wrong: ${EVIL}`, T0 + 5000);
  e.tick(s, true, T0 + 6000);
  e.end(s, T0 + 7000);
  return s;
}

describe("the record", () => {
  it("has every message, note and tick, and no seat ids", () => {
    const r = exportRecord(played(), T0 + 8000);
    expect(r).toMatchObject({ version: 1, ticks: 2, startedAt: "2026-10-12T18:00:01.000Z", endedAt: "2026-10-12T18:00:07.000Z", exportedAt: "2026-10-12T18:00:08.000Z" });
    expect(r.messages.map((m) => [m.id, m.status])).toEqual([
      ["c1-1", "delivered"],
      ["m-1", "pending"],
      ["c1-2", "dropped"],
    ]);
    expect(r.notes).toHaveLength(1);
    expect(r.roles.find((x) => x.id === "memory")).toMatchObject({ playedBy: [e.clean(EVIL, e.LIMITS.name)], secret: expect.stringMatching(/= 42/) });
    expect(r.roles.find((x) => x.id === "cpu-2")).toMatchObject({ playedBy: [], secret: null });
    expect(JSON.stringify(r)).not.toMatch(/"seat"/);
  });
});

describe("the replay page", () => {
  const html = renderReplay(exportRecord(played(), T0 + 8000));

  it("escapes everything people typed", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<[^>]*onerror/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The only <script> is the page's own step-through.
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it("tells it tick by tick, with what the bus did", () => {
    expect(html).toContain('data-tick="1"');
    expect(html).toContain('data-tick="2"');
    expect(html).toMatch(/The bus delivered <code>c1-1<\/code> to MEMORY/);
    expect(html).toMatch(/dropped <code>c1-2<\/code>; MEMORY never got it/);
    expect(html).toMatch(/still waiting at the bus.*m-1/);
    expect(html).toMatch(/started it before .* sent done/);
  });

  it("is self-contained: nothing from the network", () => {
    expect(html).not.toMatch(/<(?:link|img|iframe)\b|src=["']?https?:|@import|url\(/i);
  });

  it("gets the glossary popovers (glossary/)", () => {
    const decorated = renderReplay(exportRecord(played(), T0), (page) => buildPage(page, loadGlossary(), loadSnippet()).html);
    const result = buildPage(renderReplay(exportRecord(played(), T0)), loadGlossary(), loadSnippet());
    expect(result.missing).toEqual([]);
    expect(result.placed.sort()).toEqual([...WEEK_02_ACT_IT_OUT.glossary].sort());
    expect(decorated).toContain('class="term"');
    expect(decorated).toContain("<script data-glossary>");
    // No popover inside anything a student typed.
    expect(decorated).not.toMatch(/&lt;script[^<]*<span class="term"/);
  });
});

describe("the week's in-class page", () => {
  it("lists sessions newest first, escaped, or says where the live one is", () => {
    const r = exportRecord(played(), T0);
    const page = renderIndex(2, [indexEntry("2026-10-12", r), indexEntry("2026-10-12-2", r), indexEntry("2026-10-05", r)], "https://class.example.org/");
    expect(page.indexOf("2026-10-12-2.html")).toBeLessThan(page.indexOf('"2026-10-12.html"'));
    expect(page.indexOf('"2026-10-12.html"')).toBeLessThan(page.indexOf("2026-10-05.html"));
    expect(page).toContain("2 ticks · 3 messages · 1 note");
    const empty = renderIndex(2, [], `https://x.example/"><script>`);
    expect(empty).toContain("Nothing here yet");
    expect(empty).not.toContain('"><script>');
  });
});

describe("file names and folders", () => {
  it("names a session by its day, never clashing, digits and dashes only", () => {
    const day = new Date(T0);
    expect(exportName(day, [])).toBe("2026-10-12");
    expect(exportName(day, ["2026-10-12.json", "2026-10-12.html", "index.html"])).toBe("2026-10-12-2");
    expect(exportName(day, ["2026-10-12.json", "2026-10-12-2.html"])).toBe("2026-10-12-3");
    expect(() => exportName(new Date(NaN), [])).toThrow();
  });

  it("puts each week's sessions in its own fixed folder", () => {
    expect(exportDir(2)).toBe("week-02");
    expect(() => exportDir(0)).toThrow();
    expect(() => exportDir(2.5)).toThrow();
  });

  it("escapes quotes too", () => {
    expect(escHtml(`a"b'c<d>&`)).toBe("a&quot;b&#39;c&lt;d&gt;&amp;");
  });
});
