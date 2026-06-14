import { createInterface } from "node:readline/promises";

// The interactive seam. Kept behind an interface so the command orchestration is testable with a fake
// (canned answers) — the real implementation uses node:readline. This is where requirement #3 lives:
// a manual step the CLI can't perform is shown, then waitForDone BLOCKS until the operator confirms.

export interface Prompt {
  /** Ask a free-text question; returns the trimmed answer ("" if the operator just pressed Enter). */
  ask(question: string): Promise<string>;
  /** Yes/No, defaulting to NO — used for the APPLY confirmation gate. */
  confirm(question: string): Promise<boolean>;
  /** Block until the operator acknowledges a manual step is finished (Enter to continue). */
  waitForDone(question: string): Promise<void>;
}

export function createPrompt(): Prompt {
  async function ask(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  }
  return {
    ask,
    async confirm(question) {
      const answer = (await ask(`${question} [y/N] `)).toLowerCase();
      return answer === "y" || answer === "yes";
    },
    async waitForDone(question) {
      await ask(`${question} `);
    },
  };
}

/** A scripted prompt for tests: each call consumes the next canned answer (default "" when exhausted). */
export function createFakePrompt(answers: readonly string[]): Prompt & { asked: string[] } {
  const queue = [...answers];
  const asked: string[] = [];
  async function ask(question: string): Promise<string> {
    asked.push(question);
    return queue.shift() ?? "";
  }
  return {
    asked,
    ask,
    async confirm(question) {
      const answer = (await ask(question)).toLowerCase();
      return answer === "y" || answer === "yes";
    },
    async waitForDone(question) {
      await ask(question);
    },
  };
}
