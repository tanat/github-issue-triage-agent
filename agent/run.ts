import crypto from 'node:crypto';
import {
  streamText,
  generateText,
  stepCountIs,
  gateway,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import { propagateAttributes } from '@langfuse/tracing';
import { tools } from '@/tools/registry';
import { systemPrompt } from '@/agent/system-prompt';
import { dedupRecentToolCalls } from '@/tools/__helpers__/dedup';
import { withAnthropicCache } from '@/agent/prepare-step-cache';
import { logStep } from '@/agent/log';
import { TriageCard, type TriageCard as TriageCardType } from '@/schemas/v1/triage-card';
import type { TrajectoryStep } from '@/evals/score';

export const STEP_HARD_CAP = 8;
export const TOKEN_BUDGET = 50_000;

export const MODEL_IDS = {
  sonnet: 'claude-sonnet-4-6',
  'gpt-4o': 'gpt-4o',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-pro': 'gemini-2.5-pro',
} as const;

export type ModelKey = keyof typeof MODEL_IDS;

export function modelFor(key: ModelKey): LanguageModel {
  if (key === 'gpt-4o') return gateway('openai/gpt-4o') as unknown as LanguageModel;
  if (key === 'gemini-flash') return gateway('google/gemini-2.5-flash') as unknown as LanguageModel;
  if (key === 'gemini-pro') return gateway('google/gemini-2.5-pro') as unknown as LanguageModel;
  return gateway('anthropic/claude-sonnet-4-6') as unknown as LanguageModel;
}

/**
 * Trace-grouping attributes propagated to every span the AI SDK emits during a
 * run (see the propagateAttributes wrap around streamText/generateText below).
 * Re-triaging the same issue shares a `sessionId`, so the runs group together in
 * the Langfuse dashboard; `tags` let you slice traces by model. The `runId` rides
 * along as searchable metadata. All a no-op when the Langfuse env keys are unset.
 */
function triageTraceContext(issueUrl: string, modelKey: ModelKey, runId: string) {
  const m = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  const sessionId = m ? `${m[1]}/${m[2]}#${m[3]}` : issueUrl.slice(0, 200);
  return {
    sessionId,
    tags: ['triage', modelKey],
    metadata: { runId },
  };
}

export interface RunTriageOptions {
  issueUrl: string;
  parsedSummary: string;
  modelKey?: ModelKey;
  runId?: string;
}

export function runTriage(opts: RunTriageOptions) {
  const modelKey: ModelKey = opts.modelKey ?? 'sonnet';
  const modelId = MODEL_IDS[modelKey];
  const runId = opts.runId ?? crypto.randomUUID();
  const startedAt = Date.now();
  let stepStartedAt = startedAt;
  let stepIdx = 0;
  let cumulativeTokens = 0;
  let budgetWarned = false;

  // For Anthropic models, mark the system prompt as a sticky cache breakpoint
  // and the rolling tail as an ephemeral one (added per-step in prepareStep).
  // Sonnet 4-6 + ephemeral caching: cached input tokens cost $0.30/M instead
  // of $3/M, which on this corpus (~70K accumulated input per fixture) drops
  // a full eval pass from ~$7.65 to ~$1.50. Cache breakpoints are passed via
  // providerOptions on the message blocks; non-Anthropic models ignore them.
  const isAnthropic = modelKey === 'sonnet';
  const initialMessages: ModelMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
      ...(isAnthropic && {
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      }),
    },
    {
      role: 'user',
      content: `Triage this GitHub issue: ${opts.issueUrl}\n${opts.parsedSummary}`,
    },
  ];

  const stream = propagateAttributes(
    triageTraceContext(opts.issueUrl, modelKey, runId),
    () =>
      streamText({
        model: modelFor(modelKey),
        messages: initialMessages,
        tools,
        stopWhen: stepCountIs(STEP_HARD_CAP),
        // Emit OpenTelemetry spans (one per LLM step + tool call) that the
        // LangfuseSpanProcessor in instrumentation.ts exports to Langfuse.
        // No-op if Langfuse env keys are unset — the SDK still emits spans, but
        // nothing exports them. runId/model land as searchable trace metadata.
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'triage-stream',
          metadata: { runId, modelKey, model: modelId },
        },
        prepareStep: isAnthropic
          ? withAnthropicCache(dedupRecentToolCalls)
          : dedupRecentToolCalls,
        onStepFinish: ({ toolCalls, toolResults, usage, finishReason, text }) => {
          const now = Date.now();
          const latencyMs = now - stepStartedAt;
          stepStartedAt = now;
          const firstCall = toolCalls?.[0];
          const firstResult = toolResults?.[0];
          const tokensIn = usage?.inputTokens ?? 0;
          const tokensOut = usage?.outputTokens ?? 0;
          cumulativeTokens += tokensIn + tokensOut;
          if (!budgetWarned && cumulativeTokens > TOKEN_BUDGET) {
            budgetWarned = true;
            console.warn(
              `[run ${runId}] token budget exceeded: ${cumulativeTokens} > ${TOKEN_BUDGET} tokens. ` +
                `Letting current loop finish but expect truncation.`,
            );
          }
          logStep({
            runId,
            stepIdx,
            model: modelId,
            toolName: firstCall?.toolName ?? null,
            toolArgs: firstCall?.input,
            toolResult: (firstResult as { output?: unknown } | undefined)?.output,
            stepText: text || null,
            finishReason: finishReason ?? null,
            tokensIn,
            tokensOut,
            latencyMs,
          });
          stepIdx += 1;
        },
      }),
  );

  return { runId, stream, startedAt };
}

export interface TriageRunResult {
  runId: string;
  card: TriageCardType | null;
  steps: TrajectoryStep[];
  totalTokens: number;
  totalLatencyMs: number;
  finishReason: string | null;
}

function extractCard(text: string): TriageCardType | null {
  if (!text) return null;
  // Strip markdown code fences if present: ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = TriageCard.safeParse(JSON.parse(candidate.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function runTriageOnce(opts: RunTriageOptions): Promise<TriageRunResult> {
  const modelKey: ModelKey = opts.modelKey ?? 'sonnet';
  const modelId = MODEL_IDS[modelKey];
  const runId = opts.runId ?? crypto.randomUUID();
  const startedAt = Date.now();
  let stepStartedAt = startedAt;
  let stepIdx = 0;
  let cumulativeTokens = 0;
  const steps: TrajectoryStep[] = [];
  const allStepTexts: string[] = [];

  // Same caching strategy as the streaming path — see runTriage above.
  const isAnthropic = modelKey === 'sonnet';
  const initialMessages: ModelMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
      ...(isAnthropic && {
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      }),
    },
    {
      role: 'user',
      content: `Triage this GitHub issue: ${opts.issueUrl}\n${opts.parsedSummary}`,
    },
  ];

  const result = await propagateAttributes(
    triageTraceContext(opts.issueUrl, modelKey, runId),
    () =>
      generateText({
        model: modelFor(modelKey),
        messages: initialMessages,
        tools,
        stopWhen: stepCountIs(STEP_HARD_CAP),
        // Same telemetry as the streaming path. functionId distinguishes eval/once
        // runs from live stream runs in the Langfuse dashboard.
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'triage-once',
          metadata: { runId, modelKey, model: modelId },
        },
        prepareStep: isAnthropic
          ? withAnthropicCache(dedupRecentToolCalls)
          : dedupRecentToolCalls,
        onStepFinish: ({ toolCalls, toolResults, usage, finishReason, text }) => {
          const now = Date.now();
          const latencyMs = now - stepStartedAt;
          stepStartedAt = now;
          const firstCall = toolCalls?.[0];
          const firstResult = toolResults?.[0];
          const tokensIn = usage?.inputTokens ?? 0;
          const tokensOut = usage?.outputTokens ?? 0;
          cumulativeTokens += tokensIn + tokensOut;
          if (text) allStepTexts.push(text);
          steps.push({
            toolName: firstCall?.toolName ?? null,
            toolArgs: firstCall?.input,
          });
          logStep({
            runId,
            stepIdx,
            model: modelId,
            toolName: firstCall?.toolName ?? null,
            toolArgs: firstCall?.input,
            toolResult: (firstResult as { output?: unknown } | undefined)?.output,
            stepText: text || null,
            finishReason: finishReason ?? null,
            tokensIn,
            tokensOut,
            latencyMs,
          });
          stepIdx += 1;
        },
      }),
  );

  // Try result.text first (final step text), then step texts in reverse (handles cap-hit runs).
  let card: TriageCardType | null = extractCard(result.text ?? '');
  if (!card) {
    for (let i = allStepTexts.length - 1; i >= 0; i--) {
      card = extractCard(allStepTexts[i]);
      if (card) break;
    }
  }

  return {
    runId,
    card,
    steps,
    totalTokens: cumulativeTokens,
    totalLatencyMs: Date.now() - startedAt,
    finishReason: result.finishReason ?? null,
  };
}
