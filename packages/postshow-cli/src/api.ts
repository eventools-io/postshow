// Client for the postshow-api gateway. One POST per call, authenticated with
// the personal access token.

import type { CliConfig } from './config';

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function gateway<T = Record<string, unknown>>(
  config: Pick<CliConfig, 'apiUrl' | 'token'>,
  op: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  if (!config.token) {
    throw new GatewayError('no access token; run `postshow init` first', 401);
  }
  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/functions/v1/postshow-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-postshow-token': config.token,
    },
    body: JSON.stringify({ op, ...args }),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    detail?: string;
  };
  if (!response.ok || data.ok === false) {
    throw new GatewayError(
      String(data.detail ?? `gateway error (${response.status})`),
      response.status
    );
  }
  return data as T;
}
