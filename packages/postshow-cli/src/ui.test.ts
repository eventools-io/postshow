import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  NonInteractivePromptError,
  PromptCancelledError,
  askSecret,
  type SecretPromptIO,
} from './ui';

function promptHarness(inputIsTty = true, outputIsTty = true) {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (mode: boolean) => void;
  };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  const rawModes: boolean[] = [];
  let written = '';
  input.isTTY = inputIsTty;
  input.isRaw = false;
  input.setRawMode = (mode) => {
    rawModes.push(mode);
    input.isRaw = mode;
  };
  output.isTTY = outputIsTty;
  output.on('data', (chunk) => {
    written += chunk.toString('utf8');
  });
  return {
    input,
    output,
    rawModes,
    written: () => written,
    io: { input, output } as SecretPromptIO,
  };
}

describe('askSecret', () => {
  it('reads, edits, and returns a secret without echoing it', async () => {
    const harness = promptHarness();
    const answer = askSecret('API key', harness.io);
    harness.input.write('s3cr');
    harness.input.write(Buffer.from([0x7f]));
    harness.input.write('ret\r');

    await expect(answer).resolves.toBe('s3cret');
    expect(harness.written()).toBe('API key: \n');
    expect(harness.written()).not.toContain('s3cret');
    expect(harness.rawModes).toEqual([true, false]);
  });

  it('restores terminal mode when the user cancels', async () => {
    const harness = promptHarness();
    const answer = askSecret('Token', harness.io);
    harness.input.write('\u0003');

    await expect(answer).rejects.toBeInstanceOf(PromptCancelledError);
    expect(harness.rawModes).toEqual([true, false]);
    expect(harness.written()).toBe('Token: \n');
  });

  it.each([
    [false, true],
    [true, false],
  ])('fails closed when input/output TTY state is %s/%s', async (inputTty, outputTty) => {
    const harness = promptHarness(inputTty, outputTty);

    await expect(askSecret('Token', harness.io)).rejects.toBeInstanceOf(NonInteractivePromptError);
    expect(harness.rawModes).toEqual([]);
    expect(harness.written()).toBe('');
  });

  it('restores terminal mode when writing the prompt fails', async () => {
    const harness = promptHarness();
    harness.output.write = (() => {
      throw new Error('output failed');
    }) as typeof harness.output.write;

    await expect(askSecret('Token', harness.io)).rejects.toThrow('output failed');
    expect(harness.rawModes).toEqual([true, false]);
  });
});
