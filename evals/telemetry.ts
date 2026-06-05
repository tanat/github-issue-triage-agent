// Standalone OpenTelemetry bootstrap for CLI scripts (eval harness, trace
// inspector) that run under `tsx`, NOT Next.js. Next loads instrumentation.ts
// automatically; a bare `tsx` process does not, so scripts must register the
// provider themselves and flush before exiting — otherwise spans never ship.
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

let processor: LangfuseSpanProcessor | null = null;

/** Register the Langfuse OTEL provider once. Safe to call multiple times. */
export function initTelemetry(): void {
  if (processor) return;
  processor = new LangfuseSpanProcessor();
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
}

/** Ship all buffered spans. Call before the process exits. */
export async function flushTelemetry(): Promise<void> {
  if (processor) await processor.forceFlush();
}
