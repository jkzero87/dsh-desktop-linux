// The failed edit of session d636e7e1 (2026-11-24): read seq43 of sql/030_silver.sql, edit seq102 → FS_EDIT_NOT_FOUND.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diagnoseEditMiss, rewriteReadText } from "../lib/whitespace.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/d636e7e1-seq102.json", import.meta.url), "utf8"));
const options = { maxReportedLines: 6 };

/** Numbered lines of a read envelope. */
function numberedLines(readText) {
  const body = readText.split("<content>\n")[1].split("\n</content>")[0];
  return body.split("\n").filter((line) => /^\d+/u.test(line));
}

/** The file lines 27-34 as the read showed them: upstream's `N: ` prefix is exactly 2 characters after the number. */
const fileLines = numberedLines(fixture.readText).map((line) => line.replace(/^\d+: /u, ""));
const file = fileLines.join("\n");
const sent = fixture.editArguments.old_string;

test("the failed old_string is what copying after the colon of the old read format gives", () => {
  // The model kept the space after "N:" as indentation on the deeply indented comment lines 32 and 34.
  const afterColon = numberedLines(fixture.readText).map((line) => line.replace(/^\d+:/u, ""));
  const sentLines = sent.split("\n");
  assert.equal(sentLines.length, 8);
  assert.equal(sentLines[5], afterColon[5]);
  assert.equal(sentLines[7], afterColon[7]);
  assert.equal(file.includes(sent), false);
  assert.equal(sentLines[5].match(/^ */u)[0].length, 45);
  assert.equal(fileLines[5].match(/^ */u)[0].length, 44);
});

test("with the tab format, the text after the separator is the file line and the edit text matches", () => {
  const rewritten = rewriteReadText(fixture.readText);
  assert.notEqual(rewritten, undefined);
  const lines = numberedLines(rewritten);
  assert.deepEqual(lines.map((line) => line.split("\t")[0]), ["27", "28", "29", "30", "31", "32", "33", "34"]);
  const copied = lines.map((line) => line.slice(line.indexOf("\t") + 1)).join("\n");
  assert.equal(copied, file);
  assert.equal(file.includes(copied), true);
  // The footer and envelope are unchanged.
  assert.equal(rewritten.replace(/^(\d+)\t/gmu, "$1: "), fixture.readText);
});

test("the old_string with one space too many gets the line and the exact difference", () => {
  const diagnosis = diagnoseEditMiss(file, sent, options);
  assert.match(diagnosis, /^Closest match: lines 1-8; only whitespace differs\.$/mu);
  assert.match(diagnosis, /^- line 6, leading whitespace: old_string has 45 spaces, the file has 44 spaces\.$/mu);
  assert.match(diagnosis, /^- line 8, leading whitespace: old_string has 45 spaces, the file has 44 spaces\.$/mu);
  assert.ok(diagnosis.includes(`  file line 6: ${JSON.stringify(fileLines[5])}`));
  assert.doesNotMatch(diagnosis, /line [1-57],/u);
});

test("in the whole file the reported numbers are the file's own line numbers", () => {
  // Pad lines 1-26 so the window sits at lines 27-34, as in the 146-line file.
  const padded = [...Array.from({ length: 26 }, (_, i) => `-- line ${i + 1}`), ...fileLines].join("\n");
  const diagnosis = diagnoseEditMiss(padded, sent, options);
  assert.match(diagnosis, /^Closest match: lines 27-34; only whitespace differs\.$/mu);
  assert.match(diagnosis, /^- line 32, leading whitespace: old_string has 45 spaces, the file has 44 spaces\.$/mu);
  assert.match(diagnosis, /^- line 34, leading whitespace: old_string has 45 spaces, the file has 44 spaces\.$/mu);
});
