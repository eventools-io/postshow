import { supabase } from './supabase';

interface FunctionFailureBody {
  code?: unknown;
  detail?: unknown;
}

export class PostshowFunctionError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, code = '', status: number | null = null) {
    super(message);
    this.name = 'PostshowFunctionError';
    this.code = code;
    this.status = status;
  }
}

function responseFromError(error: unknown): Response | null {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: unknown }).context;
  return context instanceof Response ? context : null;
}

async function functionError(error: unknown): Promise<PostshowFunctionError> {
  const response = responseFromError(error);
  let body: FunctionFailureBody | null = null;
  if (response) {
    try {
      body = (await response.clone().json()) as FunctionFailureBody;
    } catch {
      // A non-JSON provider response is intentionally reduced to a safe message.
    }
  }
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  const message = detail || (error instanceof Error ? error.message : 'Request failed');
  return new PostshowFunctionError(
    message,
    typeof body?.code === 'string' ? body.code : '',
    response?.status ?? null
  );
}

export async function invokePostshowFunction(
  name: string,
  body: Record<string, unknown>,
  options: { accessToken?: string } = {}
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    ...(options.accessToken ? { headers: { Authorization: `Bearer ${options.accessToken}` } } : {}),
  });
  if (error) throw await functionError(error);
  if (data === null || data === undefined) {
    throw new PostshowFunctionError('The server returned an empty response.');
  }
  return data;
}
