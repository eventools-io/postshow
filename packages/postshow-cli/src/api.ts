// Client for the postshow-api gateway. One POST per call, authenticated with
// the personal access token. Every network and response-body phase shares one
// deadline so a stalled gateway cannot keep a CLI or desktop process alive.

import { isLoopbackHostname, isUnsafePublicHostname } from '@eventools/postshow-core';
import type { CliConfig } from './config';

export const GATEWAY_TIMEOUT_MS = 45_000;
const MAX_GATEWAY_RESPONSE_BYTES = 2 * 1024 * 1024;

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** Resolve the only URL that may receive the Postshow access token. Remote
 * gateways must be public HTTPS origins. Plain HTTP is reserved for explicit
 * loopback development, and no URL component may smuggle credentials. */
export function resolveGatewayEndpoint(raw: string): string {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new GatewayError('gateway base URL is invalid', 400);
  }

  const loopback = isLoopbackHostname(base.hostname);
  const publicHttps = base.protocol === 'https:' && !isUnsafePublicHostname(base.hostname);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    (!publicHttps && !(base.protocol === 'http:' && loopback))
  ) {
    throw new GatewayError(
      'gateway base URL must be a public HTTPS origin or a loopback HTTP development origin',
      400
    );
  }

  return new URL('/functions/v1/postshow-api', base.origin).href;
}

async function readGatewayBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new GatewayError('gateway response exceeded the 2 MiB safety limit', 502);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GATEWAY_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new GatewayError('gateway response exceeded the 2 MiB safety limit', 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function gateway<T = Record<string, unknown>>(
  config: Pick<CliConfig, 'apiUrl' | 'token'>,
  op: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  if (!config.token) {
    throw new GatewayError('no access token; run `postshow init` first', 401);
  }
  if (!config.apiUrl) {
    throw new GatewayError('no API URL configured; run `postshow init` first', 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const response = await fetch(resolveGatewayEndpoint(config.apiUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-postshow-token': config.token,
      },
      body: JSON.stringify({ op, ...args }),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new GatewayError('gateway redirects are not allowed', response.status);
    }

    const body = await readGatewayBody(response);
    let data: Record<string, unknown> = {};
    if (body) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        } else if (response.ok) {
          throw new GatewayError('gateway returned invalid JSON', 502);
        }
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (response.ok) throw new GatewayError('gateway returned invalid JSON', 502);
      }
    }

    if (!response.ok || data.ok !== true) {
      // Remote detail is deliberately not surfaced: an upstream proxy or
      // handler could reflect request credentials into an error body.
      const status = response.ok ? 502 : response.status;
      throw new GatewayError(`gateway request failed (${status})`, status);
    }
    return data as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GatewayError('gateway request timed out', 408);
    }
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('gateway request failed before a response was received', 503);
  } finally {
    clearTimeout(timeout);
  }
}
