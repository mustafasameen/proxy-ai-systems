// All network code. Each request gets an incrementing token so callers can ignore a superseded response.

export const TIMEOUT_MS = 15000;

export function baseUrl() {
  let url;
  try {
    url = import.meta.env && import.meta.env.VITE_API_URL;
  } catch {
    url = undefined;
  }
  return String(url || 'http://localhost:8787').replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status || null;
  }
}

let counter = 0;

// Code for an HTTP failure, from the body when it carries one, otherwise from the status.
export function codeFromResponse(status, body) {
  const detail = body && body.detail;
  const fromBody = (detail && !Array.isArray(detail) && detail.error) || (body && body.error);
  if (fromBody) return fromBody;
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout';
  if (status === 503) return 'model_unavailable';
  if (status === 422) return 'no_options';
  if (status === 404) return 'unknown_person';
  return 'server_error';
}

function messageFromResponse(body) {
  const detail = body && body.detail;
  if (detail && !Array.isArray(detail) && detail.message) return detail.message;
  if (body && body.message) return body.message;
  return '';
}

// Starts a request. Returns { token, promise, cancel }. The promise resolves with parsed JSON
// or rejects with an ApiError whose code is one of: timeout, network, cancelled, or the API's error code.
export function request(path, { method = 'GET', body, timeoutMs = TIMEOUT_MS, fetchImpl, base } = {}) {
  counter += 1;
  const token = counter;
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  const promise = (async () => {
    try {
      let res;
      try {
        res = await doFetch(`${base || baseUrl()}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (timedOut) throw new ApiError('timeout', 'Timed out.');
        if (cancelled) throw new ApiError('cancelled', 'Cancelled.');
        throw new ApiError('network', 'Network error.');
      }
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        if (timedOut) throw new ApiError('timeout', 'Timed out.');
        if (cancelled) throw new ApiError('cancelled', 'Cancelled.');
        data = null;
      }
      if (!res.ok) {
        throw new ApiError(codeFromResponse(res.status, data), messageFromResponse(data), res.status);
      }
      if (data === null) throw new ApiError('server_error', '', res.status);
      return data;
    } finally {
      clearTimeout(timer);
    }
  })();

  return {
    token,
    promise,
    cancel() {
      cancelled = true;
      controller.abort();
    },
  };
}

export const getConfig = (opts) => request('/api/config', opts);

export const postPick = ({ person, decision, setting, answer }, opts) =>
  request('/api/pick', { ...opts, method: 'POST', body: { person, decision, setting, answer: answer || null } });

export const postReveal = ({ person, decision }, opts) =>
  request('/api/reveal', { ...opts, method: 'POST', body: { person, decision } });
