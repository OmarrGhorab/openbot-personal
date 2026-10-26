/**
 * The microphone samples of one streamed dictation, at the rate the cloud model takes. They are
 * kept as they arrive, so each send takes only the new ones and nothing decodes the whole
 * recording again.
 */
export class PcmBuffer {
  #parts: Float32Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  /** Keeps a copy: the audio graph reuses the buffer it hands out. */
  append(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.#parts.push(samples.slice());
    this.#length += samples.length;
  }

  /** The samples from `offset` to the end, in one array. */
  from(offset: number): Float32Array {
    const start = Math.max(0, Math.min(offset, this.#length));
    const result = new Float32Array(this.#length - start);
    let position = 0;
    let written = 0;
    for (const part of this.#parts) {
      const end = position + part.length;
      if (end > start) {
        const slice = part.subarray(Math.max(0, start - position));
        result.set(slice, written);
        written += slice.length;
      }
      position = end;
    }
    return result;
  }

  clear(): void {
    this.#parts = [];
    this.#length = 0;
  }
}

/**
 * Runs a task unless the last one is still running. A live pass that takes longer than the
 * interval is skipped, not queued, so Stop never waits behind a line of stale passes.
 */
export class SkipWhileBusy {
  #running: Promise<void> | null = null;

  get busy(): boolean {
    return this.#running !== null;
  }

  /** Starts the task, or does nothing when one is running. */
  run(task: () => Promise<void>): void {
    if (this.#running) return;
    this.#running = task()
      .catch(() => undefined)
      .finally(() => {
        this.#running = null;
      });
  }

  /** Waits for the task that is running, if any. */
  async idle(): Promise<void> {
    await this.#running;
  }
}

/**
 * Tries the final pass up to `attempts` times and returns its text. When every attempt fails it
 * throws the last error, so live text that may be cut short is never sent as the final message.
 */
export async function finalTextWithRetries(
  attempts: number,
  attempt: () => Promise<string | undefined>,
  failure: () => Error,
): Promise<string> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const text = await attempt();
      if (text !== undefined) return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? failure();
}
