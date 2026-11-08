/**
 * Behavior of the post-compaction todo restore, driven through a real agent loop against a scripted
 * mock adapter. A test `agent/pre-step` listener replaces surface nodes the same way step-pressure
 * compaction does before it delegates.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

type CheckpointSource = Extract<MessageSource, { readonly kind: 'compact-checkpoint' }>

const OPEN_LIST = [
  { content: 'inspect', status: 'completed' },
  { content: 'build', status: 'in_progress' },
  { content: 'ship', status: 'pending' },
] as const

const DONE_LIST = OPEN_LIST.map(todo => ({ ...todo, status: 'completed' as const }))

/** Boot the loop, the projection registry, the todo tool, and a no-op `probe` tool. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: false })
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  return ctx
}

/**
 * Replace every surface node after the system prompt with one checkpoint before the listed steps.
 * @returns the steps that compacted.
 */
function compactBeforeSteps(ctx: Context, steps: readonly number[]): number[] {
  const compacted: number[] = []
  ctx.on('agent/pre-step', ({ agent, step }, next): Promise<PreStepDecision> => {
    if (steps.includes(step)) {
      const nodes = agent.session.surface.nodes.slice(1)
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'summary' }],
        source: { kind: 'compact-checkpoint', compactionId: `c${step}` as CheckpointSource['compactionId'] },
      }), {
        surfaceOp: { op: 'replace', startSeq: nodes[0]!, endSeq: nodes.at(-1)! },
        sourceEventSeqs: [...nodes],
      })
      compacted.push(step)
    }
    return next()
  })
  return compacted
}

async function run(ctx: Context, responses: ReturnType<typeof textResponse>[]): Promise<{ agent: Agent; adapter: MockAdapter }> {
  const adapter = new MockAdapter(responses)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return { agent, adapter }
}

function restores(agent: Agent): SessionEvent<'user/message'>[] {
  return agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message' && event.data.source.kind === 'todo-restore')
}

function text(event: SessionEvent<'user/message'>): string {
  return event.data.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('todo restore after compaction', () => {
  it('re-enters an unfinished list once after compaction hides its todo_write result', async () => {
    const ctx = await harness()
    compactBeforeSteps(ctx, [3])
    const { agent, adapter } = await run(ctx, [
      toolCallResponse('t1', 'todo_write', { todos: OPEN_LIST }),
      toolCallResponse('p1', 'probe', {}),
      toolCallResponse('p2', 'probe', {}),
      toolCallResponse('p3', 'probe', {}),
      textResponse('done'),
    ])

    const found = restores(agent)
    expect(found).toHaveLength(1)
    expect(text(found[0]!)).toBe([
      'Context compaction removed your todo list from view. Its last state was:',
      '- [completed] inspect',
      '- [in_progress] build',
      '- [pending] ship',
      'Compare it with the work already done, then call todo_write with the complete corrected list. '
      + 'Before your final answer, mark every finished todo `completed`.',
    ].join('\n'))
    expect(found[0]!.data.source).toEqual({
      kind: 'todo-restore',
      form: 'notice',
      summary: 'todo list: 1 completed, 1 in progress, 1 pending',
    })
    const thirdRequest = JSON.stringify(adapter.requests[2]?.messages)
    expect(thirdRequest).toContain('[in_progress] build')
  })

  it('restores again when a later compaction hides the restore message', async () => {
    const ctx = await harness()
    compactBeforeSteps(ctx, [3, 4])
    const { agent } = await run(ctx, [
      toolCallResponse('t1', 'todo_write', { todos: OPEN_LIST }),
      toolCallResponse('p1', 'probe', {}),
      toolCallResponse('p2', 'probe', {}),
      toolCallResponse('p3', 'probe', {}),
      textResponse('done'),
    ])
    expect(restores(agent)).toHaveLength(2)
  })

  it('adds nothing while the todo_write result stays on the surface', async () => {
    const ctx = await harness()
    const { agent } = await run(ctx, [
      toolCallResponse('t1', 'todo_write', { todos: OPEN_LIST }),
      toolCallResponse('p1', 'probe', {}),
      textResponse('done'),
    ])
    expect(restores(agent)).toHaveLength(0)
  })

  it('adds nothing when every todo is completed', async () => {
    const ctx = await harness()
    compactBeforeSteps(ctx, [3])
    const { agent } = await run(ctx, [
      toolCallResponse('t1', 'todo_write', { todos: DONE_LIST }),
      toolCallResponse('p1', 'probe', {}),
      toolCallResponse('p2', 'probe', {}),
      textResponse('done'),
    ])
    expect(restores(agent)).toHaveLength(0)
  })

  it('tracks the latest successful write, not a rejected one', async () => {
    const ctx = await harness()
    compactBeforeSteps(ctx, [4])
    const { agent } = await run(ctx, [
      toolCallResponse('t1', 'todo_write', { todos: OPEN_LIST }),
      toolCallResponse('t2', 'todo_write', { todos: [{ content: 'x', status: 'in_progress' }, { content: 'y', status: 'in_progress' }] }),
      toolCallResponse('p1', 'probe', {}),
      toolCallResponse('p2', 'probe', {}),
      textResponse('done'),
    ])
    const found = restores(agent)
    expect(found).toHaveLength(1)
    expect(text(found[0]!)).toContain('- [in_progress] build')
  })

  it('adds nothing to a rejected step', async () => {
    const ctx = await harness()
    compactBeforeSteps(ctx, [3])
    ctx.on('agent/pre-step', async ({ step }, next): Promise<PreStepDecision> => (step === 3 ? { kind: 'reject' } : next()))
    const { agent } = await run(ctx, [
      toolCallResponse('t1', 'todo_write', { todos: OPEN_LIST }),
      toolCallResponse('p1', 'probe', {}),
      textResponse('done'),
    ])
    expect(restores(agent)).toHaveLength(0)
  })

  it('removes the visibility unit when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const fiber = await ctx.plugin(ToolTodo, { allowParallelInProgress: false })
    ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    const session = ctx.sessions.create()
    expect('todoVisibility' in ctx.sessionProjections.checkpoint(session)).toBe(true)
    await fiber.dispose()
    const after = ctx.sessions.create()
    expect('todoVisibility' in ctx.sessionProjections.checkpoint(after)).toBe(false)
  })
})
