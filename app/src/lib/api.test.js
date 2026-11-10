import { describe, it, expect, vi, afterEach } from 'vitest';
import { request, postPick, getConfig, codeFromResponse, ApiError } from './api.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('gives each request a larger token', () => {
    const f = vi.fn(async () => jsonResponse(200, {}));
    const a = request('/a', { fetchImpl: f });
    const b = request('/b', { fetchImpl: f });
    expect(b.token).toBeGreaterThan(a.token);
  });

  it('posts the pick body as JSON to the default base URL', async () => {
    const f = vi.fn(async () => jsonResponse(200, { stage: 'question' }));
    vi.stubGlobal('fetch', f);
    const r = postPick({ person: '1', decision: 0, setting: 'When unsure' });
    await expect(r.promise).resolves.toEqual({ stage: 'question' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://localhost:8787/api/pick');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ person: '1', decision: 0, setting: 'When unsure', answer: null });
  });

  it('gets config with GET and no body', async () => {
    const f = vi.fn(async () => jsonResponse(200, { people: [] }));
    vi.stubGlobal('fetch', f);
    await getConfig().promise;
    expect(f.mock.calls[0][1].method).toBe('GET');
    expect(f.mock.calls[0][1].body).toBeUndefined();
  });

  it('times out after the limit with code timeout', async () => {
    vi.useFakeTimers();
    const f = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const r = request('/slow', { fetchImpl: f, timeoutMs: 15000 });
    const caught = r.promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(15000);
    const e = await caught;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('timeout');
  });

  it('reports a user cancel as cancelled, not as an error code', async () => {
    const f = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const r = request('/x', { fetchImpl: f });
    const caught = r.promise.catch((e) => e);
    r.cancel();
    expect((await caught).code).toBe('cancelled');
  });

  it('maps a failed fetch to network', async () => {
    const f = vi.fn(async () => { throw new TypeError('fail'); });
    await expect(request('/x', { fetchImpl: f }).promise).rejects.toMatchObject({ code: 'network' });
  });

  it.each([
    [404, { detail: { error: 'no_more_decisions', message: 'm' } }, 'no_more_decisions'],
    [429, { error: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' }, 'rate_limited'],
    [503, { detail: { error: 'busy', message: 'b' } }, 'busy'],
    [503, { detail: { error: 'model_unavailable', message: 'u' } }, 'model_unavailable'],
    [504, { detail: { error: 'timeout', message: 't' } }, 'timeout'],
    [422, { detail: { error: 'no_options', message: 'n' } }, 'no_options'],
  ])('maps HTTP %i to its code', async (status, body, code) => {
    const f = vi.fn(async () => jsonResponse(status, body));
    await expect(request('/x', { fetchImpl: f }).promise).rejects.toMatchObject({ code, status });
  });

  it('falls back to the status when the body has no code', () => {
    expect(codeFromResponse(429, null)).toBe('rate_limited');
    expect(codeFromResponse(504, {})).toBe('timeout');
    expect(codeFromResponse(503, {})).toBe('model_unavailable');
    expect(codeFromResponse(422, { detail: [{ msg: 'x' }] })).toBe('no_options');
    expect(codeFromResponse(500, null)).toBe('server_error');
  });
});
