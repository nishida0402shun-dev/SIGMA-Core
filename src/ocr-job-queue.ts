import { isOcrCancelled, OcrCancelledError, throwIfAborted } from "./ocr.ts";

export interface OcrJobQueueOptions {
  /** Maximum jobs running at once. OCR defaults to one on low-memory hosts. */
  concurrency?: number;
  /** Maximum jobs waiting for a slot; further submissions fail with OCR_QUEUE_FULL. */
  maxQueueSize?: number;
}

export interface OcrJobOptions {
  signal?: AbortSignal | undefined;
}

export interface OcrJobQueueStats {
  concurrency: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface QueuedJob<T> {
  key: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal | undefined;
  removeAbortListener?: (() => void) | undefined;
}

/**
 * Bounded, in-process OCR/extraction job queue.
 *
 * - Runs at most `concurrency` jobs (default 1) so a low-memory host does not
 *   spawn overlapping Tesseract processes.
 * - Deduplicates in-flight jobs by key. Callers sharing a key share the result
 *   and the first submission's task and signal. A later caller's abort only
 *   stops that caller's wait; it does not cancel the shared job.
 * - Cancels queued jobs immediately when their signal aborts. Running jobs are
 *   expected to observe the same signal and stop themselves.
 *
 * Deduplication is in-process and in-flight only; completed results are not
 * cached. Callers that need durable deduplication must check storage first.
 */
export class OcrJobQueue {
  readonly #concurrency: number;
  readonly #maxQueueSize: number;
  readonly #queue: QueuedJob<unknown>[] = [];
  readonly #inflight = new Map<string, Promise<unknown>>();
  readonly #idleWaiters: Array<() => void> = [];
  #running = 0;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;

  constructor(options: OcrJobQueueOptions = {}) {
    const concurrency = options.concurrency ?? 1;
    const maxQueueSize = options.maxQueueSize ?? 100;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("OCR_QUEUE_INVALID_CONCURRENCY: concurrency must be a positive integer");
    }
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new Error("OCR_QUEUE_INVALID_CAPACITY: maxQueueSize must be a positive integer");
    }
    this.#concurrency = concurrency;
    this.#maxQueueSize = maxQueueSize;
  }

  run<T>(key: string, task: () => Promise<T>, options?: OcrJobOptions): Promise<T> {
    if (!key.trim()) throw new Error("OCR_QUEUE_KEY_REQUIRED: A non-empty job key is required");
    const inflight = this.#inflight.get(key);
    if (inflight) {
      const signal = options?.signal;
      if (!signal) return inflight as Promise<T>;
      try {
        throwIfAborted(signal);
      } catch (error) {
        this.#cancelled += 1;
        return Promise.reject(error);
      }
      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
          this.#cancelled += 1;
          reject(new OcrCancelledError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        inflight.then(
          (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value as T);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
    }

    const signal = options?.signal;
    try {
      throwIfAborted(signal);
    } catch (error) {
      this.#cancelled += 1;
      return Promise.reject(error);
    }
    if (this.#queue.length >= this.#maxQueueSize) {
      return Promise.reject(new Error(
        `OCR_QUEUE_FULL: ${this.#queue.length} jobs are already waiting; limit is ${this.#maxQueueSize}.`,
      ));
    }

    const promise = new Promise<T>((resolve, reject) => {
      const job: QueuedJob<T> = { key, task, resolve, reject, signal };
      if (this.#running < this.#concurrency) {
        this.#start(job);
        return;
      }
      if (signal) {
        const onAbort = (): void => {
          const index = this.#queue.indexOf(job as QueuedJob<unknown>);
          if (index < 0) return;
          this.#queue.splice(index, 1);
          this.#cancelled += 1;
          reject(new OcrCancelledError());
          this.#notifyIdle();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        job.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }
      this.#queue.push(job as QueuedJob<unknown>);
    });

    let tracked: Promise<T>;
    tracked = promise.finally(() => {
      if (this.#inflight.get(key) === tracked) this.#inflight.delete(key);
    });
    this.#inflight.set(key, tracked);
    return tracked;
  }

  stats(): OcrJobQueueStats {
    return {
      concurrency: this.#concurrency,
      running: this.#running,
      queued: this.#queue.length,
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
    };
  }

  /** Resolves when no job is running or waiting. */
  async onIdle(): Promise<void> {
    if (this.#running === 0 && this.#queue.length === 0) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  #start<T>(job: QueuedJob<T>): void {
    job.removeAbortListener?.();
    job.removeAbortListener = undefined;
    this.#running += 1;
    void Promise.resolve()
      .then(job.task)
      .then(
        (value) => {
          this.#completed += 1;
          job.resolve(value);
        },
        (error: unknown) => {
          if (isOcrCancelled(error) || job.signal?.aborted) {
            this.#cancelled += 1;
          } else {
            this.#failed += 1;
          }
          job.reject(error);
        },
      )
      .finally(() => {
        this.#running -= 1;
        this.#drain();
        this.#notifyIdle();
      });
  }

  #drain(): void {
    while (this.#running < this.#concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      this.#start(job);
    }
  }

  #notifyIdle(): void {
    if (this.#running !== 0 || this.#queue.length !== 0) return;
    for (const resolve of this.#idleWaiters.splice(0)) resolve();
  }
}
