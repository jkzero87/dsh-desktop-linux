import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, inject, name, resolveConfig } from "../lib/index.js";

/** A fake Cordis context with the services the plugin injects. */
function fakeContext(files) {
  const listeners = [];
  const warnings = [];
  const ctx = {
    on(event, listener) { listeners.push({ event, listener }); },
    logger: { warn: (message) => warnings.push(message) },
    workingDirectory: { ensure: async () => "/w" },
    fs: {
      resolve: async (path, opts) => ({ path: path.startsWith("/") ? path : `${opts.cwd}/${path}` }),
      stat: async (target) => (target.path in files ? { type: "file", size: files[target.path].length } : undefined),
      readText: async (target) => {
        if (!(target.path in files)) throw new Error("not found");
        return files[target.path];
      },
    },
  };
  return { ctx, listeners, warnings };
}

function exec(toolName, args) {
  return { name: toolName, arguments: args, agent: {}, signal: new AbortController().signal };
}

const notFound = {
  isError: true,
  error: { message: 'old_string was not found in "/w/a.sql"', info: { name: "FsError", code: "FS_EDIT_NOT_FOUND" } },
  content: [{ type: "text", text: 'Error: old_string was not found in "/w/a.sql"' }],
};

test("exports and config", () => {
  assert.equal(name, "read-edit-whitespace");
  assert.deepEqual(inject, ["fs", "workingDirectory"]);
  assert.deepEqual(resolveConfig(undefined), { maxReportedLines: 6, maxDiagnosedBytes: 2_000_000 });
  assert.throws(() => resolveConfig({ maxReportedLines: 0 }), /maxReportedLines/u);
  assert.throws(() => resolveConfig({ maxDiagnosedBytes: 1.5 }), /maxDiagnosedBytes/u);
});

test("read results get the tab numbering after the downstream listeners", async () => {
  const { ctx, listeners } = fakeContext({});
  apply(ctx, {});
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].event, "tools/post-execute");
  const text = "<path>/w/a.sql</path>\n<type>file</type>\n<content>\n1:   x\n\n(End of file - total 1 lines)\n</content>";
  const result = { isError: false, value: {}, content: [{ type: "text", text }], meta: { path: "/w/a.sql" } };
  const decision = await listeners[0].listener(exec("read", { file_path: "a.sql" }), result, async () => ({ kind: "accept" }));
  assert.equal(decision.kind, "accept");
  assert.equal(decision.content[0].text, text.replace("1:   x", "1\t  x"));
});

test("a downstream block or value replacement is passed through", async () => {
  const { ctx, listeners } = fakeContext({});
  apply(ctx, {});
  const block = { kind: "block", feedback: [{ type: "text", text: "no" }] };
  const result = { isError: false, value: {}, content: [] };
  assert.equal(await listeners[0].listener(exec("read", {}), result, async () => block), block);
  const value = { kind: "accept", value: 1 };
  assert.equal(await listeners[0].listener(exec("read", {}), result, async () => value), value);
});

test("a not-found edit keeps its code and first line and gains the diagnosis", async () => {
  const { ctx, listeners } = fakeContext({ "/w/a.sql": "SELECT\n           count(*) AS n\nFROM t" });
  apply(ctx, {});
  const decision = await listeners[0].listener(
    exec("edit", { file_path: "a.sql", old_string: "            count(*) AS n", new_string: "x" }),
    notFound,
    async () => ({ kind: "accept" }),
  );
  assert.equal(decision.kind, "block");
  assert.deepEqual(decision.info, { name: "FsError", code: "FS_EDIT_NOT_FOUND" });
  const text = decision.feedback[0].text;
  assert.ok(text.startsWith('Error: old_string was not found in "/w/a.sql"\nClosest match: line 2; only whitespace differs.'));
  assert.match(text, /old_string has 12 spaces, the file has 11 spaces/u);
});

test("other edit failures, unreadable files and unrelated tools are left alone", async () => {
  const { ctx, listeners, warnings } = fakeContext({});
  apply(ctx, {});
  const accept = { kind: "accept" };
  const ambiguous = { ...notFound, error: { message: "x", info: { name: "FsError", code: "FS_AMBIGUOUS_EDIT" } } };
  assert.equal(await listeners[0].listener(exec("edit", { file_path: "a.sql", old_string: "a" }), ambiguous, async () => accept), accept);
  assert.equal(await listeners[0].listener(exec("edit", { file_path: "missing.sql", old_string: "a" }), notFound, async () => accept), accept);
  assert.equal(warnings.length, 0);
  assert.equal(await listeners[0].listener(exec("bash", {}), notFound, async () => accept), accept);
});

test("a read failure inside the diagnosis is logged and leaves the error unchanged", async () => {
  const { ctx, listeners, warnings } = fakeContext({ "/w/a.sql": "x" });
  ctx.fs.readText = async () => { throw new Error("EACCES"); };
  apply(ctx, {});
  const accept = { kind: "accept" };
  assert.equal(await listeners[0].listener(exec("edit", { file_path: "a.sql", old_string: "y" }), notFound, async () => accept), accept);
  assert.match(warnings[0], /no diagnosis for a\.sql: EACCES/u);
});

test("a file over maxDiagnosedBytes is not read", async () => {
  const { ctx, listeners } = fakeContext({ "/w/a.sql": "x".repeat(20) });
  let reads = 0;
  const readText = ctx.fs.readText;
  ctx.fs.readText = async (target) => { reads++; return readText(target); };
  apply(ctx, { maxDiagnosedBytes: 10 });
  const accept = { kind: "accept" };
  assert.equal(await listeners[0].listener(exec("edit", { file_path: "a.sql", old_string: "y" }), notFound, async () => accept), accept);
  assert.equal(reads, 0);
});
