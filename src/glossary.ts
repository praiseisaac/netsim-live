// The glossary popovers on the exported replay page: the first time a term the exercise lists
// (ExerciseDef.glossary) appears, it gets a dotted underline and a short explanation from
// glossary/glossary.json. The popover's CSS and script (glossary/popover.*) are inlined, so the
// replay stays one self-contained file that works offline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../glossary", import.meta.url));

export function loadGlossary(dir = DIR): Glossary {
  return (JSON.parse(readFileSync(join(dir, "glossary.json"), "utf8")) as { terms: Glossary }).terms;
}

export function loadSnippet(dir = DIR): { css: string; js: string } {
  return { css: readFileSync(join(dir, "popover.css"), "utf8").trim(), js: readFileSync(join(dir, "popover.js"), "utf8").trim() };
}

/** buildPage as a function of the page alone, with this repo's glossary and snippet. */
export function glossaryDecorator(dir = DIR): (html: string) => string {
  const glossary = loadGlossary(dir);
  const snippet = loadSnippet(dir);
  return (html) => buildPage(html, glossary, snippet).html;
}

export const MAX_TERMS = 15;

export interface GlossaryTerm {
  explain: string;
  week?: number;
  /** Literal words to look for (case-insensitive in text; exact for `code` terms). */
  match?: string[];
  /** A regex used instead of `match`. */
  pattern?: string;
  /** Only match a whole inline <code> element, like <code>replyTo</code>. (A plain term matches
   * either text or a whole <code> element.) */
  code?: boolean;
}

export type Glossary = Record<string, GlossaryTerm>;

/** The terms a page opts into, in order. */
export function pageTerms(html: string): string[] {
  const meta = /<meta\s+name="glossary"\s+content="([^"]*)"\s*\/?>/.exec(html);
  if (!meta) return [];
  return meta[1].split(",").map((term) => term.trim()).filter(Boolean);
}

/** Text inside these elements is never marked: diagrams, code blocks, headings, and anything clickable. */
const SKIP = new Set(["svg", "pre", "h1", "h2", "h3", "h4", "a", "summary", "th", "nav", "title", "style", "script", "figure", "button", "label", "head"]);
const VOID = new Set(["br", "img", "meta", "link", "input", "hr", "wbr", "source", "col"]);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** How to find a term: in running text (none for code-only terms), and as a whole <code> element. */
function termRegexes(term: GlossaryTerm): { text: RegExp | null; code: RegExp } {
  const body = term.pattern ?? (term.match ?? []).map(escapeRegex).join("|");
  return {
    text: term.code ? null : new RegExp(term.pattern ? body : `(?<![\\w-])(?:${body})(?![\\w-])`, "i"),
    code: new RegExp(`^(?:${body})$`, term.code ? "" : "i"),
  };
}

/** Remove everything a previous build added. */
export function strip(html: string): string {
  return html
    .replace(/<style data-glossary>[\s\S]*?<\/style>\n?/g, "")
    .replace(/<script data-glossary>[\s\S]*?<\/script>\n?/g, "")
    .replace(/<span class="term" tabindex="0" aria-describedby="tip-\d+">([\s\S]*?)<span class="tip" role="tooltip" id="tip-\d+">[^<]*<\/span><\/span>/g, "$1");
}

export interface BuildResult {
  html: string;
  placed: string[];
  missing: string[];
}

/** Build one page: strip, then mark the first occurrence of each opted-in term. */
export function buildPage(source: string, glossary: Glossary, snippet: { css: string; js: string }): BuildResult {
  const html = strip(source);
  const wanted = pageTerms(html);
  const unknown = wanted.filter((key) => !glossary[key]);
  if (unknown.length) throw new Error(`not in glossary/glossary.json: ${unknown.join(", ")}`);
  if (wanted.length > MAX_TERMS) throw new Error(`${wanted.length} glossary terms; the limit is ${MAX_TERMS}`);
  if (wanted.length === 0) return { html, placed: [], missing: [] };

  const todo = new Map(wanted.map((key) => [key, termRegexes(glossary[key])]));
  const placed: string[] = [];
  const out: string[] = [];
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

  const wrap = (inner: string, key: string) => {
    todo.delete(key);
    placed.push(key);
    const n = placed.length;
    return `<span class="term" tabindex="0" aria-describedby="tip-${n}">${inner}<span class="tip" role="tooltip" id="tip-${n}">${escapeHtml(glossary[key].explain)}</span></span>`;
  };

  // Mark text-term occurrences in one text node, earliest match first.
  const markText = (text: string): string => {
    let result = "";
    let rest = text;
    for (;;) {
      let best: { key: string; index: number; length: number } | null = null;
      for (const [key, { text: re }] of todo) {
        if (!re) continue;
        const m = re.exec(rest);
        if (m && (!best || m.index < best.index)) best = { key, index: m.index, length: m[0].length };
      }
      if (!best) return result + rest;
      result += rest.slice(0, best.index) + wrap(rest.slice(best.index, best.index + best.length), best.key);
      rest = rest.slice(best.index + best.length);
    }
  };

  let pos = 0;
  for (;;) {
    tag.lastIndex = pos;
    const m = tag.exec(html);
    const text = html.slice(pos, m ? m.index : html.length);
    const skipping = stack.some((name) => SKIP.has(name)) || stack.includes("code");
    out.push(text && !skipping && todo.size ? markText(text) : text);
    if (!m) break;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (name === "code" && !closing && !skipping) {
      const end = html.indexOf("</code>", tag.lastIndex);
      const inner = html.slice(tag.lastIndex, end);
      const hit = [...todo].find(([, { code }]) => code.test(inner));
      if (hit) {
        out.push(wrap(html.slice(m.index, end + "</code>".length), hit[0]));
        pos = end + "</code>".length;
        continue;
      }
    }
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (!VOID.has(name) && !m[0].endsWith("/>")) {
      stack.push(name);
    }
    out.push(m[0]);
    pos = tag.lastIndex;
  }

  let built = out.join("");
  if (placed.length) {
    built = built.replace("</head>", `<style data-glossary>\n${snippet.css}\n</style>\n</head>`);
    built = built.replace("</body>", `<script data-glossary>\n${snippet.js}\n</script>\n</body>`);
  }
  return { html: built, placed, missing: [...todo.keys()] };
}
