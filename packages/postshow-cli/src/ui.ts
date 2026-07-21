// Terminal helpers. Plain ANSI, no dependencies; every prompt supports a
// default and secrets are never echoed back after entry.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';

const AMBER = '\x1b[33m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

export function say(text: string): void {
  stdout.write(`${text}\n`);
}

export function dim(text: string): void {
  stdout.write(`${DIM}${text}${RESET}\n`);
}

export function ok(text: string): void {
  stdout.write(`${GREEN}✓${RESET} ${text}\n`);
}

export function warn(text: string): void {
  stdout.write(`${AMBER}!${RESET} ${text}\n`);
}

export function fail(text: string): void {
  stdout.write(`${RED}✗${RESET} ${text}\n`);
}

export function heading(text: string): void {
  stdout.write(`\n${AMBER}${text}${RESET}\n`);
}

export async function ask(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback ? ` ${DIM}(${fallback})${RESET}` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

interface SecretInput extends Pick<Readable, 'on' | 'off' | 'pause' | 'resume'> {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
}

interface SecretOutput extends Pick<Writable, 'write'> {
  isTTY?: boolean;
}

export interface SecretPromptIO {
  input: SecretInput;
  output: SecretOutput;
}

export class NonInteractivePromptError extends Error {
  readonly code = 'POSTSHOW_NON_INTERACTIVE';

  constructor() {
    super('secret input requires an interactive terminal; run `postshow init` in a TTY');
    this.name = 'NonInteractivePromptError';
  }
}

export class PromptCancelledError extends Error {
  readonly code = 'POSTSHOW_PROMPT_CANCELLED';

  constructor() {
    super('secret input cancelled');
    this.name = 'PromptCancelledError';
  }
}

/** Read a secret directly from a TTY with echo disabled. Piped stdin/stdout
 * fails closed so credentials cannot be accidentally written to logs. */
export async function askSecret(
  question: string,
  io: SecretPromptIO = { input: stdin, output: stdout }
): Promise<string> {
  const { input, output } = io;
  if (!input.isTTY || !output.isTTY || !input.setRawMode) {
    throw new NonInteractivePromptError();
  }

  const wasRaw = input.isRaw === true;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('error', onError);
    input.setRawMode?.(wasRaw);
    input.pause();
  };

  let value = '';
  let resolvePrompt: (answer: string) => void;
  let rejectPrompt: (error: Error) => void;

  const finish = (answer: string) => {
    restore();
    output.write('\n');
    resolvePrompt(answer.trim());
  };
  const cancel = (error: Error) => {
    restore();
    output.write('\n');
    rejectPrompt(error);
  };
  const onEnd = () => cancel(new PromptCancelledError());
  const onError = (error: Error) => cancel(error);
  const onData = (chunk: string | Buffer) => {
    for (const character of chunk.toString('utf8')) {
      if (character === '\r' || character === '\n') {
        finish(value);
        return;
      }
      if (character === '\u0003' || character === '\u0004') {
        cancel(new PromptCancelledError());
        return;
      }
      if (character === '\u0008' || character === '\u007f') {
        value = Array.from(value).slice(0, -1).join('');
        continue;
      }
      if (character >= ' ') value += character;
    }
  };

  const answer = new Promise<string>((resolve, reject) => {
    resolvePrompt = resolve;
    rejectPrompt = reject;
  });

  try {
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
    output.write(`${question}: `);
    return await answer;
  } finally {
    restore();
  }
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = await ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'}`);
  if (!answer) return fallback;
  return /^y/i.test(answer);
}

export async function choose(
  question: string,
  options: string[],
  fallback: string
): Promise<string> {
  const answer = await ask(`${question} ${DIM}[${options.join('/')}]${RESET}`, fallback);
  return options.includes(answer) ? answer : fallback;
}
