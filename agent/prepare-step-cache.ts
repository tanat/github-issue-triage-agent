import type { ModelMessage, PrepareStepFunction } from 'ai';
import type { Tools } from '@/tools/registry';

// Wraps an existing prepareStep callback so that, on every step, the LAST
// message in the rolling conversation also carries an ephemeral
// cacheControl breakpoint. Anthropic caches everything up to and including
// the breakpoint, so each subsequent step replays the prior tool-result tail
// from cache instead of re-billing it at full input price.
//
// The breakpoint is mutated onto a clone (not the original message object)
// so the cache marker doesn't leak back into the harness's `messages` array.
export function withAnthropicCache(
  inner: PrepareStepFunction<Tools>,
): PrepareStepFunction<Tools> {
  return async (ctx) => {
    const innerResult = await inner(ctx);
    const innerMessages =
      innerResult && 'messages' in innerResult
        ? (innerResult.messages as ModelMessage[] | undefined)
        : undefined;
    const baseMessages: ModelMessage[] = innerMessages ?? ctx.messages;
    if (baseMessages.length === 0) return innerResult;
    const lastIdx = baseMessages.length - 1;
    const cloned: ModelMessage[] = baseMessages.map((m, i) => {
      if (i !== lastIdx) return m;
      return {
        ...m,
        providerOptions: {
          ...(m.providerOptions ?? {}),
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      } as ModelMessage;
    });
    return { ...(innerResult ?? {}), messages: cloned };
  };
}
