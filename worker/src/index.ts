// Zoom Reader's free server: a Cloudflare Worker that runs an open AI model
// (Gemma 4 by default) on Cloudflare's free daily Workers AI allowance.
//
// - It only runs Zoom Reader's own fixed tasks (src/zoom/prompts.ts), never
//   arbitrary prompts, and caps how much text each request can send.
// - It only answers pages on emrekaraarslan.com (and local previews).
// - It keeps a running total of the day's usage so no single visitor can use
//   up the shared allowance, and it reports when the allowance is gone so the
//   page can offer "bring your own key" instead.
// - It never stores documents. Visitors are counted by a one-way hash of
//   their IP address, and the counts are deleted after two days.
//
// On the free plan Cloudflare simply stops serving AI requests once the daily
// allowance is used, so this can't run up a bill.

import { DurableObject } from 'cloudflare:workers';
import { buildPrompt, parseTaskInput } from '../../src/zoom/prompts';

interface Env {
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  QUOTA: DurableObjectNamespace<Quota>;
  MODEL?: string;
  ALLOWED_ORIGINS?: string;
  DAILY_NEURONS?: string;
  VISITOR_NEURONS?: string;
  MOCK_AI?: string;
}

// Neurons (Cloudflare's billing unit) per million tokens, from
// developers.cloudflare.com/workers-ai/platform/pricing/
const RATES: Record<string, [number, number]> = {
  '@cf/google/gemma-4-26b-a4b-it': [9_091, 27_273],
  '@cf/openai/gpt-oss-20b': [18_182, 27_273],
  '@cf/qwen/qwen3-30b-a3b-fp8': [4_625, 30_475],
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': [4_119, 34_868],
};
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const MAX_BODY = 80_000; // bytes
const CHARS_PER_TOKEN = 3.6;

const json = (body: unknown, status: number, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('origin') ?? '';
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

async function visitorId(ip: string, day: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`zoom-reader:${day}:${ip}`));
  return [...new Uint8Array(bytes)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);
    const cors = origin ? corsHeaders(origin) : {};

    if (req.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors });
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'zoom-reader', model: env.MODEL || DEFAULT_MODEL }, 200, cors);
    }
    if (url.pathname !== '/v1/zoom') return json({ code: 'not-found', message: 'Not found.' }, 404, cors);
    if (req.method !== 'POST') return json({ code: 'bad-request', message: 'Use POST.' }, 405, cors);
    if (!origin) return json({ code: 'forbidden', message: 'This server only answers Zoom Reader on emrekaraarslan.com.' }, 403);

    const length = Number(req.headers.get('content-length') ?? 0);
    if (length > MAX_BODY) return json({ code: 'bad-request', message: 'Request too large.' }, 413, cors);
    let body: unknown;
    try {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ code: 'bad-request', message: 'Request too large.' }, 413, cors);
      body = JSON.parse(raw);
    } catch {
      return json({ code: 'bad-request', message: 'Expected JSON.' }, 400, cors);
    }
    const input = parseTaskInput(body);
    if (typeof input === 'string') return json({ code: 'bad-request', message: input }, 400, cors);

    const model = env.MODEL || DEFAULT_MODEL;
    const [inRate, outRate] = RATES[model] ?? [30_000, 100_000];
    const prompt = buildPrompt(input);
    const inTokens = (prompt.system.length + prompt.user.length) / CHARS_PER_TOKEN;
    const estimate = (inTokens * inRate + prompt.maxTokens * outRate) / 1e6;

    const day = new Date().toISOString().slice(0, 10); // Cloudflare's allowance resets at 00:00 UTC
    const quota = env.QUOTA.get(env.QUOTA.idFromName(day));
    const visitor = await visitorId(req.headers.get('cf-connecting-ip') ?? 'unknown', day);
    const limits = { daily: Number(env.DAILY_NEURONS ?? 9_500), visitor: Number(env.VISITOR_NEURONS ?? 2_500) };

    let check: { ok: boolean; code?: string };
    try {
      check = await quota.reserve(visitor, estimate, limits);
    } catch {
      check = { ok: true }; // if the counter is unavailable, don't block anyone
    }
    if (!check.ok) {
      const message =
        check.code === 'allowance'
          ? 'Today’s free allowance is used up.'
          : check.code === 'visitor-limit'
            ? 'You’ve used your share of today’s free allowance.'
            : 'Too many requests at once. Try again in a few seconds.';
      return json({ code: check.code, message }, 429, cors);
    }

    let upstream: ReadableStream<Uint8Array>;
    try {
      upstream = env.MOCK_AI
        ? mockStream(input.task)
        : ((await env.AI.run(model, {
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            stream: true,
            max_completion_tokens: prompt.maxTokens,
            temperature: 0.4,
            chat_template_kwargs: { enable_thinking: false },
          })) as ReadableStream<Uint8Array>);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      ctx.waitUntil(quota.settle(visitor, estimate, 0).catch(() => {}));
      if (/4006|daily free allocation|neurons/i.test(message)) {
        ctx.waitUntil(quota.exhaust().catch(() => {}));
        return json({ code: 'allowance', message: 'Today’s free allowance is used up.' }, 429, cors);
      }
      console.error('Workers AI error', message.slice(0, 300));
      return json({ code: 'busy', message: 'The AI model is busy. Try again in a moment.' }, 503, cors);
    }

    // Re-emit the model's stream in Zoom Reader's own simple format:
    //   data: {"t":"next piece of text"}   ...   data: [DONE]
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let outChars = 0;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    let buffer = '';

    const handle = (data: string, controller: TransformStreamDefaultController<Uint8Array>) => {
      if (data === '[DONE]') return;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (chunk.usage) usage = chunk.usage;
      // Workers AI streams either {"response": "..."} or OpenAI-style deltas.
      // Reasoning text, if any, is never forwarded.
      const piece = typeof chunk.response === 'string' ? chunk.response : chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.text;
      if (typeof piece === 'string' && piece) {
        outChars += piece.length;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: piece })}\n\n`));
      }
    };

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const ev of events) {
          for (const line of ev.split(/\r?\n/)) if (line.startsWith('data:')) handle(line.slice(5).trim(), controller);
        }
      },
      flush(controller) {
        for (const line of buffer.split(/\r?\n/)) if (line.startsWith('data:')) handle(line.slice(5).trim(), controller);
        if (!outChars) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ code: 'busy', message: 'The model returned an empty answer.' })}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        const u = usage as { prompt_tokens?: number; completion_tokens?: number } | null;
        const actual = ((u?.prompt_tokens ?? inTokens) * inRate + (u?.completion_tokens ?? outChars / CHARS_PER_TOKEN) * outRate) / 1e6;
        ctx.waitUntil(quota.settle(visitor, estimate, actual).catch(() => {}));
      },
    });

    return new Response(upstream.pipeThrough(transform), {
      headers: {
        ...cors,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
} satisfies ExportedHandler<Env>;

/** One instance per UTC day: the day's running totals. */
export class Quota extends DurableObject<Env> {
  async reserve(visitor: string, estimate: number, limits: { daily: number; visitor: number }): Promise<{ ok: boolean; code?: string }> {
    const s = this.ctx.storage;
    if (!(await s.getAlarm())) await s.setAlarm(Date.now() + 2 * 24 * 3600 * 1000);
    if (await s.get<boolean>('exhausted')) return { ok: false, code: 'allowance' };

    const total = (await s.get<number>('total')) ?? 0;
    if (total + estimate > limits.daily) return { ok: false, code: 'allowance' };

    const key = `v:${visitor}`;
    const v = (await s.get<{ n: number; recent: number[] }>(key)) ?? { n: 0, recent: [] };
    const now = Date.now();
    v.recent = v.recent.filter((t) => now - t < 60_000);
    if (v.recent.length >= 40) return { ok: false, code: 'slow-down' };
    if (v.n + estimate > limits.visitor) return { ok: false, code: 'visitor-limit' };

    v.n += estimate;
    v.recent.push(now);
    await s.put({ total: total + estimate, [key]: v });
    return { ok: true };
  }

  /** Swaps the up-front estimate for what the request actually used. */
  async settle(visitor: string, estimate: number, actual: number): Promise<void> {
    const s = this.ctx.storage;
    const diff = actual - estimate;
    const key = `v:${visitor}`;
    const total = (await s.get<number>('total')) ?? 0;
    const v = await s.get<{ n: number; recent: number[] }>(key);
    const writes: Record<string, unknown> = { total: Math.max(0, total + diff) };
    if (v) writes[key] = { ...v, n: Math.max(0, v.n + diff) };
    await s.put(writes);
  }

  /** Cloudflare said the allowance is gone: stop trying until tomorrow. */
  async exhaust(): Promise<void> {
    await this.ctx.storage.put('exhausted', true);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/** Fake model output for testing on a computer without Workers AI. */
function mockStream(task: string): ReadableStream<Uint8Array> {
  const text =
    task === 'summary'
      ? 'A test summary title\n\nThis is a test summary of the section. It stands in for the real model while testing.'
      : task === 'gist'
        ? 'This is a test gist of the whole document, standing in for the real model.'
        : task === 'short'
          ? 'A one-sentence test version of this passage.'
          : 'This is test text standing in for the model.\n\nIt has a second paragraph, with **bold** words and a list:\n- one point\n- another point';
  const encoder = new TextEncoder();
  const words = text.split(/(?<= )/);
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= words.length) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`));
    },
  });
}
