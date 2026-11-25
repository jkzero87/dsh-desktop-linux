/**
 * dsh-read-edit-whitespace: two `tools/post-execute` listeners that keep whitespace exact between read and edit,
 * without patching the upstream fs tools.
 *
 * - `read`: the numbered lines `N: text` become `N\ttext`. Upstream separates the number with a colon and a space,
 *   and the model counted that space as indentation (session d636e7e1 seq102: 45 spaces sent, 44 in the file).
 * - `edit` failing with `FS_EDIT_NOT_FOUND`: the error keeps its code and first line, and gains the closest match
 *   with its line number and the exact whitespace difference.
 *
 * Both replace only the result content, which the session logs as the `tool/result`, so the model-visible text
 * stays reconstructable from the log.
 * @module dsh-read-edit-whitespace
 */
import { diagnoseEditMiss, rewriteReadText } from "./whitespace.js";

const name = "read-edit-whitespace";
const inject = ["fs", "workingDirectory"];

/**
 * Validate the plugin config; misconfiguration fails at load.
 * @param {object | undefined} config - the row config.
 * @returns {{maxReportedLines: number, maxDiagnosedBytes: number}} the resolved config.
 */
export function resolveConfig(config) {
  const maxReportedLines = config?.maxReportedLines ?? 6;
  if (!Number.isInteger(maxReportedLines) || maxReportedLines < 1) {
    throw new Error("dsh-read-edit-whitespace: config.maxReportedLines must be a positive integer");
  }
  const maxDiagnosedBytes = config?.maxDiagnosedBytes ?? 2_000_000;
  if (!Number.isInteger(maxDiagnosedBytes) || maxDiagnosedBytes < 1) {
    throw new Error("dsh-read-edit-whitespace: config.maxDiagnosedBytes must be a positive integer");
  }
  return { maxReportedLines, maxDiagnosedBytes };
}

/**
 * Map the text blocks of a content array, keeping every other block.
 * @param {object[]} content - tool result content blocks.
 * @param {(text: string) => string | undefined} rewrite - returns the new text or `undefined` to keep a block.
 * @returns {object[] | undefined} the new content, or `undefined` when no block changed.
 */
function mapText(content, rewrite) {
  let changed = false;
  const next = content.map((block) => {
    if (block.type !== "text") return block;
    const text = rewrite(block.text);
    if (text === undefined) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? next : undefined;
}

function apply(ctx, config) {
  const options = resolveConfig(config);

  /** Read the file the failed edit targeted, resolved the way the edit tool resolves it. */
  async function readEditTarget(exec, filePath) {
    const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal);
    const target = await ctx.fs.resolve(filePath, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal });
    const info = await ctx.fs.stat(target, exec.signal);
    if (info === undefined || (typeof info.size === "number" && info.size > options.maxDiagnosedBytes)) return undefined;
    return ctx.fs.readText(target, exec.signal);
  }

  ctx.on("tools/post-execute", async (exec, result, next) => {
    const downstream = await next();
    if (downstream.kind !== "accept" || Object.hasOwn(downstream, "value")) return downstream;
    const content = downstream.content ?? result.content;

    if (exec.name === "read" && !result.isError) {
      const rewritten = mapText(content, rewriteReadText);
      return rewritten === undefined ? downstream : { ...downstream, content: rewritten };
    }

    if (exec.name === "edit" && result.isError && result.error.info?.code === "FS_EDIT_NOT_FOUND") {
      const args = exec.arguments;
      if (typeof args?.file_path !== "string" || typeof args?.old_string !== "string" || args.old_string === "") {
        return downstream;
      }
      let diagnosis;
      try {
        const text = await readEditTarget(exec, args.file_path);
        if (text === undefined || exec.signal.aborted) return downstream;
        diagnosis = diagnoseEditMiss(text, args.old_string, options);
      } catch (error) {
        // The diagnosis is advisory: a file that cannot be read leaves the upstream error unchanged.
        ctx.logger.warn(`read-edit-whitespace: no diagnosis for ${args.file_path}: ${error?.message ?? error}`);
        return downstream;
      }
      if (diagnosis === undefined) return downstream;
      const original = content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      return {
        kind: "block",
        feedback: [{ type: "text", text: `${original}\n${diagnosis}` }],
        info: result.error.info,
        ...(downstream.additionalContexts === undefined ? {} : { additionalContexts: downstream.additionalContexts }),
      };
    }

    return downstream;
  });
}

export { name, inject, apply };
