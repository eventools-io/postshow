// Terminal helpers. Plain ANSI, no dependencies; every prompt supports a
// default and secrets are never echoed back after entry.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

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
