// Sends one zoom task to an AI model and streams the answer back.
//
// Two routes:
//   free  → the site's Cloudflare Worker, which runs an open model on
//           Cloudflare's free daily allowance (worker/src/index.ts)
//   key   → straight from the visitor's browser to Anthropic, Google or
//           OpenAI with the visitor's own key. The key is never sent to the
//           Worker or anywhere else.

import { buildPrompt, cleanOutput, type TaskInput } from './prompts';

export type Provider = 'anthropic' | 'gemini' | 'openai';

export interface Route {
  mode: 'free' | 'key';
  server?: string;
  provider?: Provider;
  key?: string;
  model?: string;
}

export type ErrorCode =
  | 'allowance' // the day's free allowance is used up
  | 'visitor-limit' // this visitor has used their share of today's allowance
  | 'slow-down' // too many requests in a short time
  | 'busy' // the model or server had a problem; trying again may work
  | 'auth' // the visitor's key was rejected
  | 'quota' // the visitor's own account is out of credit or rate limited
  | 'no-route' // nothing to send the request to
  | 'bad-request'
  | 'aborted';

export class AiError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export const PROVIDERS: Record<Provider, { name: string; model: string; keyUrl: string; keyHint: string }> = {
  anthropic: {
    name: 'Anthropic (Claude)',
    model: 'claude-haiku-5-5',
    keyUrl: 'https://platform.claude.com/',
    keyHint: 'sk-ant-…',
  },
  gemini: {
    name: 'Google (Gemini)',
    model: 'gemini-flash-latest',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
  },
  openai: {
    name: 'OpenAI',
    model: 'gpt-5-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
  },
};

/** Reads a server-sent-events stream and calls `onEvent` for each event. */
async function readSse(res: Response, onEvent: (event: string, data: string) => void, signal?: AbortSignal) {
  if (!res.body) throw new AiError('busy', 'The response had no body.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new AiError('aborted', 'Stopped.');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        let event = 'message';
        const data: string[] = [];
        for (const line of part.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) onEvent(event, data.join('\n'));
      }
    }
    if (buffer.trim()) {
      const data = buffer.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (data) onEvent('message', data);
    }
  } finally {
    reader.releaseLock();
  }
}

const tryJson = (s: string): any => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

async function errorFrom(res: Response, route: Route): Promise<AiError> {
  const body = await res.text().catch(() => '');
  const json = tryJson(body);
  const message: string =
    json?.message ?? json?.error?.message ?? (typeof json?.error === 'string' ? json.error : '') ?? '';
  if (route.mode === 'free') {
    const code = json?.code as ErrorCode | undefined;
    if (code && ['allowance', 'visitor-limit', 'slow-down', 'bad-request'].includes(code)) return new AiError(code, message);
    return new AiError('busy', message || `The server answered ${res.status}.`);
  }
  const who = PROVIDERS[route.provider!].name;
  if (res.status === 401 || res.status === 403 || /api[_ ]?key/i.test(message) && res.status === 400) {
    return new AiError('auth', `${who} didn’t accept this key. ${message}`.trim());
  }
  if (res.status === 429 || /credit|quota|billing|balance/i.test(message)) {
    return new AiError('quota', `${who} says this key is out of credit or over its rate limit. ${message}`.trim());
  }
  if (res.status === 400 || res.status === 404) return new AiError('bad-request', `${who}: ${message || res.statusText}`);
  return new AiError('busy', `${who} had a problem (${res.status}). ${message}`.trim());
}

/**
 * Runs one task. `onText` receives the text written so far, each time more
 * arrives. Resolves with the full, tidied text.
 */
export async function runTask(
  route: Route,
  input: TaskInput,
  onText: (sofar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let text = '';
  const add = (piece: unknown) => {
    if (typeof piece !== 'string' || !piece) return;
    text += piece;
    onText(cleanOutput(text));
  };

  let res: Response;
  try {
    res = await send(route, input, signal);
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error)?.name === 'AbortError') throw new AiError('aborted', 'Stopped.');
    throw new AiError('busy', 'Couldn’t reach the AI service. Check your connection and try again.');
  }
  if (!res.ok) throw await errorFrom(res, route);

  let streamError: AiError | null = null;
  await readSse(
    res,
    (event, data) => {
      if (data === '[DONE]') return;
      const json = tryJson(data);
      if (!json) return;
      if (route.mode === 'free') {
        if (event === 'error') streamError = new AiError((json.code as ErrorCode) || 'busy', json.message || 'The model stopped early.');
        else add(json.t);
      } else if (route.provider === 'anthropic') {
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') add(json.delta.text);
        else if (json.type === 'error') streamError = new AiError('busy', json.error?.message || 'Claude stopped early.');
      } else if (route.provider === 'gemini') {
        for (const part of json.candidates?.[0]?.content?.parts ?? []) if (!part.thought) add(part.text);
        if (json.error) streamError = new AiError('busy', json.error.message || 'Gemini stopped early.');
      } else {
        add(json.choices?.[0]?.delta?.content);
        if (json.error) streamError = new AiError('busy', json.error.message || 'OpenAI stopped early.');
      }
    },
    signal,
  ).catch((err) => {
    if (err instanceof AiError) throw err;
    if ((err as Error)?.name === 'AbortError') throw new AiError('aborted', 'Stopped.');
    throw new AiError('busy', 'The connection dropped while the answer was being written.');
  });

  if (streamError && !text.trim()) throw streamError;
  const out = cleanOutput(text);
  if (!out) throw streamError ?? new AiError('busy', 'The model returned an empty answer. Try again.');
  return out;
}

function send(route: Route, input: TaskInput, signal?: AbortSignal): Promise<Response> {
  if (route.mode === 'free') {
    if (!route.server) throw new AiError('no-route', 'The free server isn’t connected yet.');
    return fetch(`${route.server.replace(/\/+$/, '')}/v1/zoom`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  }

  if (!route.key || !route.provider) throw new AiError('no-route', 'Add your API key first.');
  const prompt = buildPrompt(input);
  const model = route.model?.trim() || PROVIDERS[route.provider].model;

  if (route.provider === 'anthropic') {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': route.key,
        'anthropic-version': '2023-06-01',
        // Required for calls made from a browser with the visitor's own key.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: prompt.maxTokens,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        stream: true,
      }),
      signal,
      referrerPolicy: 'no-referrer',
    });
  }

  if (route.provider === 'gemini') {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': route.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        // Newer Gemini models think before answering, and that counts toward
        // this limit, so leave plenty of room. The prompt sets the length.
        generationConfig: { maxOutputTokens: 8_192 },
      }),
      signal,
      referrerPolicy: 'no-referrer',
    });
  }

  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${route.key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: true,
      // Reasoning models spend part of this on thinking, so leave room.
      max_completion_tokens: Math.max(4_000, prompt.maxTokens * 4),
    }),
    signal,
    referrerPolicy: 'no-referrer',
  });
}
