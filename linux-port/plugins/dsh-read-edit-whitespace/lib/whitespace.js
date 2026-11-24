/**
 * Pure text functions of dsh-read-edit-whitespace: the tab-separated read numbering and the whitespace
 * diagnosis appended to a failed edit. Nothing here does I/O.
 * @module dsh-read-edit-whitespace/whitespace
 */

/** The upstream read envelope (`packages/fs/tool-fs/src/read-render.ts` `formatReadOutput`). */
const READ_ENVELOPE = /^(<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n)([\s\S]*)(\n<\/content>)$/u;

/** The upstream line prefix: the line number, a colon and one space. */
const COLON_PREFIX = /^(\d+): /u;

/** A line that starts with a read prefix in either format. */
const ANY_PREFIX = /^\s*\d+(?:: |\t)/u;

/**
 * Rewrite the numbered lines of a read envelope from `N: text` to `N\ttext`, so the line text starts right after
 * the tab. The envelope, the blank line and the footer stay byte-identical.
 * @param {string} text - a read tool result text block.
 * @returns {string | undefined} the rewritten text, or `undefined` when the text is not a read envelope or has no
 *   numbered line.
 */
export function rewriteReadText(text) {
  const envelope = READ_ENVELOPE.exec(text);
  if (envelope === null) return undefined;
  let changed = false;
  const body = envelope[2].split("\n").map((line) => {
    const prefix = COLON_PREFIX.exec(line);
    if (prefix === null) return line;
    changed = true;
    return `${prefix[1]}\t${line.slice(prefix[0].length)}`;
  });
  return changed ? `${envelope[1]}${body.join("\n")}${envelope[3]}` : undefined;
}

/**
 * Split a line into its words and the whitespace before each word and after the last one.
 * @param {string} line - one line without its newline.
 * @returns {{words: string[], before: string[], after: string, starts: number[]}} `before[i]` precedes `words[i]`
 *   and `starts[i]` is the 0-based column of `words[i]`.
 */
function splitWords(line) {
  const words = [];
  const before = [];
  const starts = [];
  let pending = "";
  let column = 0;
  for (const run of line.match(/[ \t]+|[^ \t]+/gu) ?? []) {
    if (/^[ \t]/u.test(run)) {
      pending = run;
    } else {
      words.push(run);
      before.push(pending);
      starts.push(column);
      pending = "";
    }
    column += run.length;
  }
  return { words, before, after: pending, starts };
}

/**
 * Name a whitespace run by its counts, e.g. `12 spaces`, `1 tab and 4 spaces`, `no whitespace`.
 * @param {string} run - a run of spaces and tabs.
 * @returns {string} the description.
 */
export function describeWhitespace(run) {
  const tabs = [...run].filter((c) => c === "\t").length;
  const spaces = run.length - tabs;
  const parts = [];
  if (tabs > 0) parts.push(`${tabs} ${tabs === 1 ? "tab" : "tabs"}`);
  if (spaces > 0) parts.push(`${spaces} ${spaces === 1 ? "space" : "spaces"}`);
  return parts.length === 0 ? "no whitespace" : parts.join(" and ");
}

/**
 * Compare one old_string line with one file line, ignoring how much whitespace separates the words.
 * The first old line may start inside a file line and the last may end inside one; every other line must cover
 * the whole file line.
 * @param {string} oldLine - the old_string line.
 * @param {string} fileLine - the candidate file line.
 * @param {{first: boolean, last: boolean}} position - where the old line sits in old_string.
 * @returns {{diffs: {where: string, expected: string, actual: string}[]} | undefined} the whitespace differences
 *   (empty when the line matches exactly), or `undefined` when the words do not line up.
 */
function compareLine(oldLine, fileLine, position) {
  const o = splitWords(oldLine);
  const f = splitWords(fileLine);
  const diffs = [];
  if (o.words.length === 0) {
    if (f.words.length > 0 && !(position.first || position.last)) return undefined;
    if (f.words.length === 0 && oldLine !== fileLine && !(position.first && position.last)) {
      diffs.push({ where: "whitespace-only line", expected: oldLine, actual: fileLine });
    }
    return { diffs };
  }
  const m = o.words.length;
  for (let k = 0; k + m <= f.words.length; k++) {
    if (!position.first && k !== 0) break;
    if (!position.last && k + m !== f.words.length) continue;
    const firstPartial = position.first && o.before[0] === "";
    const lastPartial = position.last && o.after === "";
    const aligned = o.words.every((word, i) => {
      const fileWord = f.words[k + i];
      if (m === 1 && firstPartial && lastPartial) return fileWord.includes(word);
      if (i === 0 && firstPartial && fileWord.endsWith(word)) return true;
      if (i === m - 1 && lastPartial && fileWord.startsWith(word)) return true;
      return fileWord === word;
    });
    if (!aligned) continue;
    if (o.before[0] !== "" || !position.first) {
      if (o.before[0] !== f.before[k] && f.words[k] === o.words[0]) {
        diffs.push({ where: "leading whitespace", expected: o.before[0], actual: f.before[k] });
      }
    }
    for (let i = 1; i < m; i++) {
      if (o.before[i] !== f.before[k + i]) {
        diffs.push({
          where: `before "${o.words[i]}" (column ${f.starts[k + i] + 1})`,
          expected: o.before[i],
          actual: f.before[k + i],
        });
      }
    }
    if ((o.after !== "" || !position.last) && k + m === f.words.length && o.after !== f.after) {
      diffs.push({ where: "trailing whitespace", expected: o.after, actual: f.after });
    }
    return { diffs };
  }
  return undefined;
}

/**
 * Find where old_string almost occurs in the file and say how its whitespace differs, so the model can correct
 * old_string without re-reading the file.
 * @param {string} content - the file content, LF-normalized like the upstream edit compares it.
 * @param {string} oldString - the old_string the edit could not find.
 * @param {{maxReportedLines: number}} options - how many differing lines to describe.
 * @returns {string | undefined} the diagnosis text, or `undefined` when there is nothing useful to add.
 */
export function diagnoseEditMiss(content, oldString, options) {
  const fileLines = content.replace(/\r\n?/gu, "\n").split("\n");
  const oldLines = oldString.replace(/\r\n?/gu, "\n").split("\n");
  let best = { start: -1, matched: 0, lines: [] };
  for (let start = 0; start + oldLines.length <= fileLines.length; start++) {
    const lines = [];
    for (let j = 0; j < oldLines.length; j++) {
      const compared = compareLine(oldLines[j], fileLines[start + j], { first: j === 0, last: j === oldLines.length - 1 });
      if (compared === undefined) break;
      lines.push({ number: start + j + 1, diffs: compared.diffs });
    }
    if (lines.length > best.matched) best = { start, matched: lines.length, lines };
    if (best.matched === oldLines.length) break;
  }
  const out = [];
  const prefixed = oldLines.filter((line) => line.trim() !== "");
  if (prefixed.length > 0 && prefixed.every((line) => ANY_PREFIX.test(line))) {
    out.push("old_string seems to include read line numbers; copy only the text after the tab that follows each line number.");
  }
  if (best.matched === oldLines.length) {
    const differing = best.lines.filter((line) => line.diffs.length > 0);
    const first = best.lines[0].number;
    const last = best.lines.at(-1).number;
    out.push(`Closest match: line${first === last ? ` ${first}` : `s ${first}-${last}`}; only whitespace differs.`);
    for (const line of differing.slice(0, options.maxReportedLines)) {
      for (const diff of line.diffs) {
        out.push(`- line ${line.number}, ${diff.where}: old_string has ${describeWhitespace(diff.expected)}, the file has ${describeWhitespace(diff.actual)}.`);
      }
      out.push(`  file line ${line.number}: ${JSON.stringify(fileLines[line.number - 1])}`);
    }
    if (differing.length > options.maxReportedLines) {
      out.push(`(${differing.length - options.maxReportedLines} more lines differ the same way.)`);
    }
  } else if (best.matched > 0) {
    const next = best.start + best.matched;
    out.push(`Closest match starts at line ${best.start + 1}: the first ${best.matched} of ${oldLines.length} old_string lines match ignoring whitespace; old_string line ${best.matched + 1} does not match file line ${next + 1}.`);
    out.push(`  old_string line ${best.matched + 1}: ${JSON.stringify(oldLines[best.matched])}`);
    out.push(`  file line ${next + 1}: ${JSON.stringify(fileLines[next] ?? "")}`);
  }
  return out.length === 0 ? undefined : out.join("\n");
}
