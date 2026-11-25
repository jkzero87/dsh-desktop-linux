// Run with test/run-loop-integration.sh: it copies this file into packages/core/agent-loop/tests (relative imports below assume that place), runs vitest on it and removes the copy.
// A max-tokens cut at an almost full context, with the installed dsh-compaction-select engine: does compaction run before the continuation request?
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
// @ts-expect-error -- plain JS plugin outside the workspace
import * as AutoContinue from '../../../../linux-port/plugins/dsh-auto-continue/lib/index.js'
// @ts-expect-error -- run-loop-integration.sh copies the installed dsh-compaction-select lib/index.js here as .ts, so vite resolves its imports through tsconfig paths
import SelectEngine from './zz-dsh-compaction-select.ts'

// The profile's compaction row and route, unscaled (compaction-select's MIN_SUMMARY_BUDGET 3072 and
// SUMMARY_SAFETY_TOKENS 1024 are absolute): contextWindow 65536 (= llama-server -c 65536), outputReserveTokens 2048,
// safetyMarginTokens 6144, maxTokens 8192, compactionRetries 2, so the pressure threshold is 57344.
const WINDOW = 65536
const PROFILE_COMPACTION = { auto: true, outputReserveTokens: 2048, safetyMarginTokens: 6144, maxTokens: 8192, compactionRetries: 2 }
const THRESHOLD = WINDOW - PROFILE_COMPACTION.outputReserveTokens - PROFILE_COMPACTION.safetyMarginTokens

/** Tokens the way the meter's heuristic counts them, so reported usage and estimates agree. */
const tokensOf = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4)

/** Three tool steps fill the context, the fourth step is cut by max-tokens near the window, then a plain answer. */
class FillingAdapter extends LlmAdapter {
  readonly conversation: { prompt: number; total: number; last: string }[] = []
  readonly summaries: number[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: WINDOW } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const prompt = tokensOf(options.messages) + tokensOf(options.tools ?? [])
    if (options.purpose === 'compaction') {
      this.summaries.push(prompt)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '## Files and Code\n- three work results read\n\n## Current Work\n- the edit is next' } }
      yield { type: 'usage', usage: { inputTokens: prompt, outputTokens: 20, totalTokens: prompt + 20 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const n = this.conversation.length
    const lastMessage = options.messages.at(-1)
    const last = lastMessage?.role === 'user' ? lastMessage.content.map(b => (b.type === 'text' ? b.text : '')).join('') : ''
    let output: number
    if (n < 3) {
      const block = { type: 'tool-call' as const, id: ToolCallId(`c${n}`), name: 'work', arguments: `{"i":${n}}` }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block }
      output = tokensOf(block)
      yield { type: 'usage', usage: { inputTokens: prompt, outputTokens: output, totalTokens: prompt + output } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (n === 3) {
      const reasoning = { type: 'reasoning' as const, text: 'design '.repeat(4790) }
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'block-end', index: 0, block: reasoning }
      output = tokensOf(reasoning)
      yield { type: 'usage', usage: { inputTokens: prompt, outputTokens: output, totalTokens: prompt + output } }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      output = 1
      yield { type: 'usage', usage: { inputTokens: prompt, outputTokens: output, totalTokens: prompt + output } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    this.conversation.push({ prompt, total: prompt + output, last })
  }
}

function idle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: s, status }) => { if (s === agent && status === 'idle') { dispose(); resolve() } })
  })
}

it('a max-tokens cut near the window is compacted before the continuation request', async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  const adapter = new FillingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'work', description: 'does work', parameters: { i: { type: 'number' } },
    async execute() { return [{ type: 'text', text: 'result line\n'.repeat(5790) }] },
  }))
  const engine = new SelectEngine(ctx, PROFILE_COMPACTION)
  const probe: string[] = []
  const engineLogger = (engine as { ctx: { logger: Record<string, (m: string) => void> } }).ctx.logger
  for (const level of ['info', 'warn', 'debug']) {
    const write = engineLogger[level]!.bind(engineLogger)
    engineLogger[level] = (message: string) => { probe.push(`logger.${level}: ${message}`); write(message) }
  }
  const original = (engine as { compactIfNeeded: (...a: unknown[]) => Promise<unknown> }).compactIfNeeded.bind(engine)
  ;(engine as { compactIfNeeded: (...a: unknown[]) => Promise<unknown> }).compactIfNeeded = async (agent: unknown, trigger: unknown, signal: unknown) => {
    const measured = ctx.tokenMeter.measure((agent as Agent).session).totalTokens
    try {
      const result = await original(agent, trigger, signal)
      probe.push(`compactIfNeeded(${String(trigger)}) measured=${measured} -> ${result === null ? 'null' : 'compacted'}`)
      return result
    } catch (error) {
      probe.push(`compactIfNeeded(${String(trigger)}) measured=${measured} -> threw ${(error as Error).message}`)
      throw error
    }
  }
  const trace = join(mkdtempSync(join(tmpdir(), 'auto-continue-fill-')), 'trace.log')
  await ctx.plugin(AutoContinue, { traceFile: trace })

  const agent = await ctx.agentLoop.create(SessionId('fill'), { provider: 'mock', model: 'mock' })
  const events: SessionEvent[] = []
  ctx.on('session/event', (_s, event) => { events.push(event) })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle(ctx, agent)

  const lines = events
    .filter(e => ['assistant/message', 'compaction/start', 'compaction/end', 'turn/end'].includes(e.type))
    .map((e) => {
      const d = e.data as { step?: number; usage?: { totalTokens: number }; stream?: { type: string; chunk?: { type: string; reason?: { kind: string } } }[]; reason?: unknown }
      const finish = d.stream?.find(r => r.type === 'chunk' && r.chunk?.type === 'finish')?.chunk?.reason?.kind
      return `${e.seq} ${e.type}${d.step === undefined ? '' : ` step=${d.step}`}${finish === undefined ? '' : ` finish=${finish}`}${d.usage === undefined ? '' : ` total=${d.usage.totalTokens}`}${e.type === 'turn/end' ? ` ${JSON.stringify(d.reason)}` : ''}`
    })
  console.log(`window=${WINDOW} threshold=${THRESHOLD}\n${lines.join('\n')}`)
  console.log('conversation requests (prompt tokens, total):', JSON.stringify(adapter.conversation.map(r => [r.prompt, r.total])))
  console.log('summary requests (prompt tokens):', JSON.stringify(adapter.summaries))
  console.log(probe.join('\n'))
  console.log(readFileSync(trace, 'utf8').trim())

  const cut = events.find(e => e.type === 'assistant/message' && JSON.stringify(e.data).includes('"max-tokens"'))!
  const compaction = events.find(e => e.type === 'compaction/start' && e.seq > cut.seq)
  const next = events.find(e => e.type === 'assistant/message' && e.seq > cut.seq)!
  expect((cut.data as { usage: { totalTokens: number } }).usage.totalTokens).toBeGreaterThanOrEqual(THRESHOLD)
  expect(adapter.conversation[3]!.prompt).toBeLessThan(THRESHOLD)
  expect(compaction).toBeDefined()
  expect(compaction!.seq).toBeLessThan(next.seq)
  expect(adapter.conversation).toHaveLength(5)
  expect(adapter.conversation[4]!.last).toBe(AutoContinue.DEFAULT_MESSAGE)
  expect(adapter.conversation[4]!.prompt).toBeLessThan(THRESHOLD)
  expect(readFileSync(trace, 'utf8').match(/\] continue /gu)).toHaveLength(1)
})
