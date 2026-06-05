import { after } from 'next/server';
import { z } from 'zod';
import { parseIssueUrl, InvalidUrlError } from '@/github/parse-url';
import { runTriage } from '@/agent/run';
import { langfuseSpanProcessor } from '@/instrumentation';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  issueUrl: z.string().min(1),
  model: z.enum(['sonnet', 'gpt-4o', 'gemini-flash', 'gemini-pro']).optional(),
  // useChat passes a messages array; we ignore it and rely on issueUrl.
  messages: z.array(z.unknown()).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const parsedBody = Body.safeParse(body);
  if (!parsedBody.success) {
    return new Response('Expected { issueUrl: string, model?: "sonnet" | "gpt-4o" }', {
      status: 400,
    });
  }

  const { issueUrl, model } = parsedBody.data;
  let parsedUrl;
  try {
    parsedUrl = parseIssueUrl(issueUrl);
  } catch (err) {
    if (err instanceof InvalidUrlError) {
      return new Response(err.message, { status: 400 });
    }
    throw err;
  }

  const { runId, stream, startedAt } = runTriage({
    issueUrl,
    parsedSummary: `(Parsed: owner=${parsedUrl.owner}, repo=${parsedUrl.repo}, number=${parsedUrl.number}.)`,
    modelKey: model,
  });

  const response = stream.toUIMessageStreamResponse();
  response.headers.set('x-run-id', runId);
  response.headers.set('x-run-started-at', String(startedAt));
  // Flush buffered Langfuse spans after the stream finishes — before the
  // serverless function freezes. Runs once the response body is fully sent.
  after(async () => {
    await langfuseSpanProcessor.forceFlush();
  });
  return response;
}
