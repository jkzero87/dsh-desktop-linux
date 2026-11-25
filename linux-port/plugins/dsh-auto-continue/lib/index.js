/**
 * dsh-auto-continue: when a turn is about to end because its last step hit the output limit (`max-tokens`), steer
 * the agent with one continuation message so the task goes on without the user typing.
 *
 * - Hook: the upstream `agent/turn-stopping` serial event. A listener that calls `agent.steer(...)` makes the loop
 *   run another step in the same turn, as the upstream Claude Code Stop-hook bridge does.
 * - Trigger: only when the turn's latest `assistant/message` finished with `max-tokens`. A completed step, an
 *   aborted turn and an error never reach a max-tokens decision.
 * - Cap: `maxContinuations` consecutive continuations; the count resets when a `user/message` with source kind
 *   `user` is logged. At the cap the turn closes and waits for the user.
 * - Children: sessions with `header.parentSession` (subagents and other delegated sessions) are left alone.
 * - The continuation is a `user/message` with source `{kind: "auto-continue", form: "notice"}`, so it is logged and
 *   rendered as an injected notice, not as a user prompt.
 * - Trace: one line per decision appended to `traceFile` (default `logs/auto-continue.log` under the DeepSeek
 *   Harness home), as dsh-cite-sources does.
 * @module dsh-auto-continue
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SOURCE_KIND, createPolicy } from "./policy.js";

const name = "auto-continue";

export const DEFAULT_MESSAGE =
  "Your previous turn was cut off by the output token limit. Continue the same task from where you stopped. "
  + "Do not restate or redesign the plan in your reasoning: make the next tool call directly.";
const DEFAULT_TRACE_FILE = "logs/auto-continue.log";

/**
 * Validate the row config; misconfiguration fails at load.
 * @param {object | undefined} config - the row config.
 * @returns {{maxContinuations: number, message: string, traceFile: string}} the resolved config.
 */
export function resolveConfig(config) {
  const maxContinuations = config?.maxContinuations ?? 3;
  if (!Number.isInteger(maxContinuations) || maxContinuations < 1) {
    throw new TypeError("auto-continue: config.maxContinuations must be a positive integer");
  }
  const message = config?.message ?? DEFAULT_MESSAGE;
  if (typeof message !== "string" || message.trim() === "") {
    throw new TypeError("auto-continue: config.message must be a non-empty string");
  }
  const traceFile = config?.traceFile ?? DEFAULT_TRACE_FILE;
  if (typeof traceFile !== "string" || traceFile.length === 0) {
    throw new TypeError("auto-continue: config.traceFile must be a non-empty path");
  }
  return { maxContinuations, message, traceFile };
}

/**
 * Build one identified, frozen continuation message (the fields `createUserMessage` produces).
 * @param {string} text - the continuation text.
 * @param {number} continuation - the 1-based continuation number, shown in the notice summary.
 * @param {number} maxContinuations - the cap, shown in the notice summary.
 * @returns {object} the user message.
 */
export function continuationMessage(text, continuation, maxContinuations) {
  return Object.freeze({
    role: "user",
    content: Object.freeze([Object.freeze({ type: "text", text })]),
    source: Object.freeze({
      kind: SOURCE_KIND,
      form: "notice",
      summary: `Output limit reached: automatic continuation ${continuation}/${maxContinuations}`,
    }),
    id: randomUUID(),
  });
}

/** Logger plus append-only trace file; a failing file write is reported once through the logger. */
function createTrace(ctx, traceFile) {
  let file = traceFile;
  if (!path.isAbsolute(file)) {
    if (typeof ctx.dshHomePath !== "function") {
      throw new TypeError("auto-continue: config.traceFile is relative but the host provides no dshHomePath");
    }
    file = ctx.dshHomePath(file);
  }
  let writeFailed = false;
  return {
    file,
    write(level, message) {
      ctx.logger[level](message);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`);
      } catch (error) {
        if (!writeFailed) ctx.logger.warn(`[auto-continue] cannot write trace file ${file}: ${error.message}`);
        writeFailed = true;
      }
    },
  };
}

function apply(ctx, config) {
  const options = resolveConfig(config);
  const policy = createPolicy(options);
  const trace = createTrace(ctx, options.traceFile);
  trace.write("info", `[auto-continue] loaded maxContinuations=${options.maxContinuations} trace=${trace.file}`);

  ctx.on("session/event", (session, event) => policy.observe(session.id, event));
  ctx.on("session/disposed", (session) => policy.forget(session.id));

  ctx.on("agent/turn-stopping", ({ agent, turn }) => {
    const session = agent.session;
    const decision = policy.decide(session.id, turn, { child: session.header?.parentSession !== undefined });
    if (decision.kind === "none") return;
    const where = `session=${session.id} turn=${turn} step=${decision.step} seq=${decision.seq}`;
    switch (decision.kind) {
      case "child":
        trace.write("info", `[auto-continue] skip-child ${where} parent=${session.header.parentSession}`);
        return;
      case "cap":
        trace.write("info", `[auto-continue] cap ${where} continuation=${decision.continuation}/${options.maxContinuations}`);
        return;
      case "continue":
        agent.steer(continuationMessage(options.message, decision.continuation, options.maxContinuations));
        trace.write("info", `[auto-continue] continue ${where} continuation=${decision.continuation}/${options.maxContinuations}`);
        return;
      default:
        throw new Error(`auto-continue: unknown decision ${decision.kind}`);
    }
  });
}

export { name, apply };
