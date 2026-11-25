// Run with test/run-loop-integration.sh: it copies this file into packages/core/agent-loop/tests (relative imports below assume that place), runs vitest on it and removes the copy.
// dsh-auto-continue against the real agent loop with the upstream MockAdapter.
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, maxTokensResponse, textResponse } from './mock-adapter.ts'
// @ts-expect-error -- plain JS plugin outside the workspace
import * as AutoContinue from '../../../../linux-port/plugins/dsh-auto-continue/lib/index.js'

async function harness(adapter: MockAdapter, trace: string) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AutoContinue, { traceFile: trace })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}
function idle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: s, status }) => { if (s === agent && status === 'idle') { dispose(); resolve() } })
  })
}
const say = (agent: Agent, text: string) => agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))

it('real loop: one cut step is continued in the same turn, and the next request carries the message', async () => {
  const adapter = new MockAdapter([maxTokensResponse('first half'), textResponse('second half')])
  const ctx = await harness(adapter, join(mkdtempSync(join(tmpdir(), 'auto-continue-loop-')), 'trace.log'))
  const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
  const ends: unknown[] = []
  ctx.on('session/event', (_s, e) => { if (e.type === 'turn/end') ends.push(e.data) })
  say(agent, 'go'); await idle(ctx, agent)
  expect(adapter.requests).toHaveLength(2)
  const last = adapter.requests[1]!.messages.at(-1) as { role: string, content: unknown, source: { kind: string } }
  expect(last.role).toBe('user')
  expect(last.source.kind).toBe('auto-continue')
  expect(last.content).toEqual([{ type: 'text', text: AutoContinue.DEFAULT_MESSAGE }])
  expect(ends).toEqual([{ turn: 1, reason: { kind: 'max-tokens' } }])
})

it('real loop: three continuations, the fourth cut waits; a user message resets the count', async () => {
  const adapter = new MockAdapter([1, 2, 3, 4].map(n => maxTokensResponse('cut ' + n)).concat([maxTokensResponse('cut after user'), textResponse('done')]))
  const ctx = await harness(adapter, join(mkdtempSync(join(tmpdir(), 'auto-continue-loop-')), 'trace.log'))
  const agent = await ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
  say(agent, 'go'); await idle(ctx, agent)
  expect(adapter.requests).toHaveLength(4)
  say(agent, 'sigue'); await idle(ctx, agent)
  expect(adapter.requests).toHaveLength(6)
})
