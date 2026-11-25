import assert from "node:assert/strict";
import { test } from "node:test";
import { describeWhitespace, diagnoseEditMiss, rewriteReadText } from "../lib/whitespace.js";

const options = { maxReportedLines: 6 };
const envelope = (body) => `<path>/w/a.sql</path>\n<type>file</type>\n<content>\n${body}\n</content>`;

test("rewriteReadText separates the number with a tab and keeps the rest byte-identical", () => {
  const text = envelope("1: a\n2: \n3:   b: c\n\n(End of file - total 3 lines)");
  assert.equal(rewriteReadText(text), envelope("1\ta\n2\t\n3\t  b: c\n\n(End of file - total 3 lines)"));
});

test("rewriteReadText leaves non-envelopes and footer-only reads alone", () => {
  assert.equal(rewriteReadText("1: not a read"), undefined);
  assert.equal(rewriteReadText(envelope("(End of file - total 0 lines)")), undefined);
  assert.equal(rewriteReadText(envelope("1\talready\n\n(End of file - total 1 lines)")), undefined);
});

test("describeWhitespace counts tabs and spaces", () => {
  assert.equal(describeWhitespace(""), "no whitespace");
  assert.equal(describeWhitespace(" "), "1 space");
  assert.equal(describeWhitespace("\t    "), "1 tab and 4 spaces");
});

test("one line with one space fewer reports both counts (the 040_gold.sql line 82 case)", () => {
  const file = "SELECT\n           count(*) AS delivered\nFROM t";
  const diagnosis = diagnoseEditMiss(file, "            count(*) AS delivered", options);
  assert.match(diagnosis, /^Closest match: line 2; only whitespace differs\.$/mu);
  assert.match(diagnosis, /^- line 2, leading whitespace: old_string has 12 spaces, the file has 11 spaces\.$/mu);
});

test("whitespace inside a line and at its end is located", () => {
  const file = "a  = 1   \nb = 2";
  const diagnosis = diagnoseEditMiss(file, "a = 1\nb = 2", options);
  assert.match(diagnosis, /^- line 1, before "=" \(column 4\): old_string has 1 space, the file has 2 spaces\.$/mu);
  assert.match(diagnosis, /^- line 1, trailing whitespace: old_string has no whitespace, the file has 3 spaces\.$/mu);
});

test("tabs against spaces are named", () => {
  const diagnosis = diagnoseEditMiss("if x:\n\treturn 1", "if x:\n    return 1", options);
  assert.match(diagnosis, /^- line 2, leading whitespace: old_string has 4 spaces, the file has 1 tab\.$/mu);
});

test("old_string may start and end inside a line", () => {
  const file = "const value = compute(a,  b) + 1;";
  const diagnosis = diagnoseEditMiss(file, "compute(a, b)", options);
  assert.match(diagnosis, /^Closest match: line 1; only whitespace differs\.$/mu);
  assert.match(diagnosis, /before "b\)" \(column 27\): old_string has 1 space, the file has 2 spaces/u);
});

test("a partial match names the first line that differs in more than whitespace", () => {
  const file = "x = 1\ny = 2\nz = 3";
  const diagnosis = diagnoseEditMiss(file, "x  = 1\ny = 9", options);
  assert.match(diagnosis, /^Closest match starts at line 1: the first 1 of 2 old_string lines match ignoring whitespace; old_string line 2 does not match file line 2\.$/mu);
  assert.ok(diagnosis.includes('  file line 2: "y = 2"'));
});

test("old_string copied with read numbers gets a hint", () => {
  const diagnosis = diagnoseEditMiss("alpha\nbeta", "1\talpha\n2\tbeta", options);
  assert.match(diagnosis, /include read line numbers/u);
  const colon = diagnoseEditMiss("alpha\nbeta", "1: alpha\n2: beta", options);
  assert.match(colon, /include read line numbers/u);
});

test("nothing similar gives no diagnosis", () => {
  assert.equal(diagnoseEditMiss("alpha\nbeta", "gamma", options), undefined);
});

test("the number of described lines is capped", () => {
  const file = Array.from({ length: 10 }, (_, i) => `  v${i}`).join("\n");
  const sent = Array.from({ length: 10 }, (_, i) => `   v${i}`).join("\n");
  const diagnosis = diagnoseEditMiss(file, sent, { maxReportedLines: 3 });
  assert.equal(diagnosis.split("\n").filter((line) => line.startsWith("- line")).length, 3);
  assert.match(diagnosis, /^\(7 more lines differ the same way\.\)$/mu);
});
