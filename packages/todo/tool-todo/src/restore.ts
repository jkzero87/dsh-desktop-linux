/**
 * Restores the todo list to the model after compaction removes it. The host-only `todoVisibility`
 * unit records which surface node last showed the list to the model: the `tool/result` of the
 * latest successful `todo_write`, or the latest restore message. Before each entering step, an
 * unfinished list whose node left the surface enters as one logged `todo-restore` message.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { TodoItem } from './types.ts'

/** Host state locating the surface node that last showed the todo list to the model. */
export interface TodoVisibility {
  /** `tool/call` seq of the latest `todo_write` call. */
  readonly callSeq: SessionSeq | null
  /** `tool/call` seq of the call that appended the latest `todo/write`, until its `tool/result` arrives. */
  readonly writeCallSeq: SessionSeq | null
  /** Surface node that last carried the whole list, or `null` before one exists in this turn. */
  readonly shownSeq: SessionSeq | null
}

const INITIAL: TodoVisibility = { callSeq: null, writeCallSeq: null, shownSeq: null }

const seqSchema = zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq)

const visibilitySchema: ZodType<TodoVisibility> = zod.object({
  callSeq: seqSchema.nullable(),
  writeCallSeq: seqSchema.nullable(),
  shownSeq: seqSchema.nullable(),
})

/**
 * Fold one event into the visibility state. The registry calls this for every committed event and
 * relies on the same reference coming back for unrelated events.
 * @param state - the current visibility state.
 * @param event - the committed session event.
 * @returns the next state.
 */
function applyVisibility(state: TodoVisibility, event: SessionEvent): TodoVisibility {
  switch (event.type) {
    case 'turn/start':
      return state === INITIAL ? state : INITIAL
    case 'tool/call':
      return event.data.name === 'todo_write' ? { ...state, callSeq: event.seq } : state
    case 'todo/write':
      return { ...state, writeCallSeq: state.callSeq }
    case 'tool/result':
      return state.writeCallSeq !== null && event.sourceEventSeqs?.includes(state.writeCallSeq) === true
        ? { ...state, writeCallSeq: null, shownSeq: event.seq }
        : state
    case 'user/message':
      return event.data.source.kind === 'todo-restore' ? { ...state, shownSeq: event.seq } : state
    default:
      return state
  }
}

/** Host-only projection of the todo list's model-visible node. */
export const todoVisibilityDefinition = {
  key: 'todoVisibility',
  stateSchema: visibilitySchema,
  init: () => INITIAL,
  apply: applyVisibility,
  stateVersion: 1,
} satisfies ProjectionDefinition<'todoVisibility', TodoVisibility>

/**
 * The model-facing restore message for one unfinished list.
 * @param todos - the latest whole list.
 * @returns the logged user message carrying the list.
 */
export function restoreMessage(todos: readonly TodoItem[]): UserMessage {
  const count = (status: TodoItem['status']): number => todos.filter(todo => todo.status === status).length
  const lines = todos.map(todo => `- [${todo.status}] ${todo.content}`)
  const text = [
    'Context compaction removed your todo list from view. Its last state was:',
    ...lines,
    'Compare it with the work already done, then call todo_write with the complete corrected list. '
    + 'Before your final answer, mark every finished todo `completed`.',
  ].join('\n')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'todo-restore',
      form: 'notice',
      summary: `todo list: ${count('completed')} completed, ${count('in_progress')} in progress, ${count('pending')} pending`,
    },
  })
}

/** Synchronous readers of the two todo projection states for one Session. */
export interface TodoReaders {
  /** The latest whole list, or `null`. */
  todos(agent: Agent): TodoItem[] | null
  /** The list's model-visible node. */
  visibility(agent: Agent): TodoVisibility
}

/**
 * Install the pre-step listener that restores a hidden unfinished list.
 * @param ctx - plugin context owning the listener.
 * @param readers - projection readers from awaited registrations.
 */
export function installRestore(ctx: Context, readers: TodoReaders): void {
  ctx.on('agent/pre-step', async ({ agent, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    // An empty first entry owns a no-step turn; adding context would turn it into a request.
    if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
    const todos = readers.todos(agent)
    if (todos === null || todos.every(todo => todo.status === 'completed')) return decision
    const { shownSeq } = readers.visibility(agent)
    if (shownSeq === null || agent.session.surface.nodes.includes(shownSeq)) return decision
    return { ...decision, messages: [...decision.messages, restoreMessage(todos)] }
  })
}
