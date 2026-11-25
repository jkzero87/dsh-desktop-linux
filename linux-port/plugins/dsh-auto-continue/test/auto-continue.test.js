import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_MESSAGE, apply, resolveConfig } from "../lib/index.js";
import { finishKindOf } from "../lib/policy.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/65177965-seq628-631.json", import.meta.url), "utf8"));
const SESSION_ID = "65177965-80b1-4401-897b-7032ef98ba4e";
const realCut = fixture.events.find((event) => event.type === "assistant/message");

/** A host stand-in: records listeners, steering and the trace file. */
function harness({ parentSession, config } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "auto-continue-"));
  const listeners = {};
  const ctx = {
    on: (event, listener) => { (listeners[event] ??= []).push(listener); },
    logger: { info() {}, warn() {} },
    dshHomePath: (relative) => path.join(home, relative),
  };
  apply(ctx, config);
  const steered = [];
  const session = { id: SESSION_ID, header: parentSession === undefined ? {} : { parentSession } };
  const agent = { session, steer: (message) => steered.push(message) };
  let seq = 700;
  return {
    steered,
    log: (event) => { for (const listener of listeners["session/event"]) listener(session, event); },
    /** Log one step of `turn` that finished with `finish`, as the loop records it. */
    step: (turn, finish) => {
      const event = structuredClone(realCut);
      event.seq = seq++;
      event.data.turn = turn;
      for (const record of event.data.stream) {
        if (record.type === "chunk" && record.chunk.type === "finish") record.chunk.reason = { kind: finish };
      }
      for (const listener of listeners["session/event"]) listener(session, event);
    },
    stopping: (turn) => { for (const listener of listeners["agent/turn-stopping"]) listener({ agent, turn, signal: new AbortController().signal }); },
    userWrites: () => {
      for (const listener of listeners["session/event"]) {
        listener(session, { type: "user/message", seq: seq++, data: { role: "user", content: [{ type: "text", text: "sigue" }], source: { kind: "user" } } });
      }
    },
    trace: () => fs.readFileSync(path.join(home, "logs/auto-continue.log"), "utf8").trim().split("\n"),
  };
}

test("the real cut step of 65177965 (seq 629) records finish max-tokens and its turn/end says max-tokens", () => {
  assert.equal(realCut.seq, 629);
  assert.equal(finishKindOf(realCut.data), "max-tokens");
  assert.deepEqual(fixture.events.at(-1).data, { turn: 2, reason: { kind: "max-tokens" } });
});

test("(a) the real max-tokens stop steers the continuation message and traces session, seq and number", () => {
  const h = harness();
  for (const event of fixture.events.slice(0, 3)) h.log(event); // step/start, assistant/message, step/end
  h.stopping(2);
  assert.equal(h.steered.length, 1);
  const [message] = h.steered;
  assert.equal(message.role, "user");
  assert.deepEqual(message.content, [{ type: "text", text: DEFAULT_MESSAGE }]);
  assert.equal(message.source.kind, "auto-continue");
  assert.equal(message.source.form, "notice");
  assert.match(message.id, /^[0-9a-f-]{36}$/u);
  assert.ok(Object.isFrozen(message));
  assert.match(h.trace().at(-1), new RegExp(`\\[auto-continue\\] continue session=${SESSION_ID} turn=2 step=6 seq=629 continuation=1/3$`, "u"));
});

test("the message text is the one the task specifies", () => {
  assert.equal(DEFAULT_MESSAGE, "Your previous turn was cut off by the output token limit. Continue the same task from where you stopped. Do not restate or redesign the plan in your reasoning: make the next tool call directly.");
});

test("(b) a normal or aborted finish does not continue", () => {
  for (const finish of ["stop", "tool-calls", "aborted", "error"]) {
    const h = harness();
    h.step(2, finish);
    h.stopping(2);
    assert.equal(h.steered.length, 0, finish);
  }
});

test("(b) a turn without any assistant message, or a max-tokens step of an earlier turn, does not continue", () => {
  const h = harness();
  h.stopping(1);
  h.step(1, "max-tokens");
  h.stopping(2);
  assert.equal(h.steered.length, 0);
});

test("after a continuation, the completed step that follows closes the turn without another message", () => {
  const h = harness();
  h.step(2, "max-tokens");
  h.stopping(2);
  h.step(2, "stop");
  h.stopping(2);
  assert.equal(h.steered.length, 1);
});

test("(c) the fourth consecutive max-tokens stop is left for the user", () => {
  const h = harness();
  for (let i = 0; i < 4; i += 1) {
    h.step(2, "max-tokens");
    h.stopping(2);
  }
  assert.equal(h.steered.length, 3);
  assert.deepEqual(h.steered.map((m) => m.source.summary), [1, 2, 3].map((n) => `Output limit reached: automatic continuation ${n}/3`));
  assert.match(h.trace().at(-1), /\[auto-continue\] cap session=\S+ turn=2 step=6 seq=\d+ continuation=3\/3$/u);
});

test("(c) the cap counts across turns until the user writes, and the plugin's own message does not reset it", () => {
  const h = harness({ config: { maxContinuations: 2 } });
  for (const turn of [2, 3, 4]) {
    h.step(turn, "max-tokens");
    h.stopping(turn);
    h.log({ type: "user/message", seq: 900 + turn, data: { ...h.steered.at(-1) } });
  }
  assert.equal(h.steered.length, 2);
});

test("(d) a user message resets the count", () => {
  const h = harness();
  for (let i = 0; i < 4; i += 1) {
    h.step(2, "max-tokens");
    h.stopping(2);
  }
  assert.equal(h.steered.length, 3);
  h.userWrites();
  h.step(3, "max-tokens");
  h.stopping(3);
  assert.equal(h.steered.length, 4);
  assert.equal(h.steered.at(-1).source.summary, "Output limit reached: automatic continuation 1/3");
});

test("a subagent or delegated session is left alone and traced", () => {
  const h = harness({ parentSession: "parent-session-id" });
  h.step(2, "max-tokens");
  h.stopping(2);
  assert.equal(h.steered.length, 0);
  assert.match(h.trace().at(-1), /\[auto-continue\] skip-child session=\S+ turn=2 .* parent=parent-session-id$/u);
});

test("misconfiguration fails at load", () => {
  assert.deepEqual(resolveConfig(undefined), { maxContinuations: 3, message: DEFAULT_MESSAGE, traceFile: "logs/auto-continue.log" });
  assert.throws(() => resolveConfig({ maxContinuations: 0 }), /maxContinuations/u);
  assert.throws(() => resolveConfig({ maxContinuations: 1.5 }), /maxContinuations/u);
  assert.throws(() => resolveConfig({ message: " " }), /message/u);
  assert.throws(() => resolveConfig({ traceFile: "" }), /traceFile/u);
});
