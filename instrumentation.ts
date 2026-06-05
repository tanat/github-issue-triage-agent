// Next.js loads this file automatically on server startup (both Node and Edge).
// We only wire OpenTelemetry in the Node.js runtime — the Langfuse exporter and
// the AI SDK calls all run there. See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// Exported so serverless route handlers can force a flush before the function
// freezes — buffered spans would otherwise be lost. Used in app/api/triage/route.ts.
// Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASEURL from the env.
export const langfuseSpanProcessor = new LangfuseSpanProcessor();

export function register() {
  // Edge runtime has no Node OTEL SDK; skip it there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const provider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  });
  provider.register();
}
