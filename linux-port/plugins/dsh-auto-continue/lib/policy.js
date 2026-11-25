/**
 * Decision state for dsh-auto-continue, kept free of the host so the tests can drive it with logged events.
 *
 * Per session it remembers how the latest `assistant/message` of each turn finished and how many automatic
 * continuations ran since the user last wrote. A `user/message` whose source kind is `user` resets the count;
 * the plugin's own continuation carries the `auto-continue` source kind, so it never resets it.
 * @module dsh-auto-continue/policy
 */

/** Source kind stamped on every continuation message. */
export const SOURCE_KIND = "auto-continue";

/**
 * The finish reason kind recorded in an `assistant/message` stream.
 * @param {object} data - the `assistant/message` event data.
 * @returns {string | undefined} the `finish` chunk's reason kind, or `undefined` when the stream has none.
 */
export function finishKindOf(data) {
  for (const record of data?.stream ?? []) {
    if (record?.type === "chunk" && record.chunk?.type === "finish") return record.chunk.reason?.kind;
  }
  return undefined;
}

/**
 * Create the per-session decision state.
 * @param {{maxContinuations: number}} options - the resolved config.
 * @returns {{observe: Function, decide: Function, forget: Function}} the state operations.
 */
export function createPolicy({ maxContinuations }) {
  /** @type {Map<string, {turn?: number, step?: number, seq?: number, finish?: string, count: number}>} */
  const sessions = new Map();
  const stateOf = (id) => {
    let state = sessions.get(id);
    if (state === undefined) {
      state = { count: 0 };
      sessions.set(id, state);
    }
    return state;
  };

  return {
    /**
     * Fold one logged session event.
     * @param {string} sessionId - the session that logged it.
     * @param {{type: string, seq?: number, data: object}} event - the logged event.
     */
    observe(sessionId, event) {
      if (event.type === "assistant/message") {
        const state = stateOf(sessionId);
        state.turn = event.data.turn;
        state.step = event.data.step;
        state.seq = event.seq;
        state.finish = finishKindOf(event.data);
      } else if (event.type === "user/message" && event.data?.source?.kind === "user") {
        stateOf(sessionId).count = 0;
      }
    },

    /**
     * Decide at the turn-stopping boundary whether to continue.
     * @param {string} sessionId - the stopping agent's session.
     * @param {number} turn - the turn about to close.
     * @param {{child: boolean}} agentInfo - whether the session belongs to a subagent or another delegated child.
     * @returns {{kind: "none"} | {kind: "child" | "cap" | "continue", seq?: number, step?: number, continuation: number}}
     *   `continue` carries the 1-based continuation number; `cap` and `child` report a max-tokens stop left alone.
     */
    decide(sessionId, turn, { child }) {
      const state = sessions.get(sessionId);
      if (state === undefined || state.turn !== turn || state.finish !== "max-tokens") return { kind: "none" };
      const at = { seq: state.seq, step: state.step };
      if (child) return { kind: "child", ...at, continuation: state.count };
      if (state.count >= maxContinuations) return { kind: "cap", ...at, continuation: state.count };
      state.count += 1;
      // The continuation step logs a new assistant/message; until then this stop is consumed.
      state.finish = undefined;
      return { kind: "continue", ...at, continuation: state.count };
    },

    /**
     * Drop a disposed session's state.
     * @param {string} sessionId - the disposed session.
     */
    forget(sessionId) {
      sessions.delete(sessionId);
    },
  };
}
