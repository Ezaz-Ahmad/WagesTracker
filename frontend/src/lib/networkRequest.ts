export const API_REQUEST_TIMEOUT_MS = 45_000;

export class RequestTimeoutError extends Error {
  constructor() { super("Request deadline exceeded"); this.name = "RequestTimeoutError"; }
}

/** Bounds the complete operation, including response-body reading. Aborting
 * fetch alone is insufficient if a transport or body reader stops responding.
 * A timed-out write is never retried here: it may have reached the server. */
export async function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal | null } = {},
): Promise<T> {
  if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new RequestTimeoutError()); controller.abort(); }, options.timeoutMs ?? API_REQUEST_TIMEOUT_MS);
    cancel = () => { reject(new DOMException("Request cancelled", "AbortError")); controller.abort(); };
    options.signal?.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    if (cancel) options.signal?.removeEventListener("abort", cancel);
  }
}
