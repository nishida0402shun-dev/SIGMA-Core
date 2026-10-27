import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OcrCancelledError } from "../src/ocr.ts";
import { OcrJobQueue } from "../src/ocr-job-queue.ts";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("OCR job queue", () => {
  it("defaults to one running job and queues the rest", async () => {
    const queue = new OcrJobQueue();
    let active = 0;
    let maxActive = 0;
    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
    };

    await Promise.all([
      queue.run("a", task),
      queue.run("b", task),
      queue.run("c", task),
    ]);

    assert.equal(maxActive, 1);
    assert.deepEqual(queue.stats(), {
      concurrency: 1,
      running: 0,
      queued: 0,
      completed: 3,
      failed: 0,
      cancelled: 0,
    });
  });

  it("honors a higher concurrency limit", async () => {
    const queue = new OcrJobQueue({ concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
    };

    await Promise.all([
      queue.run("a", task),
      queue.run("b", task),
      queue.run("c", task),
      queue.run("d", task),
    ]);

    assert.equal(maxActive, 2);
  });

  it("deduplicates in-flight jobs by key", async () => {
    const queue = new OcrJobQueue();
    let calls = 0;
    const task = async (): Promise<number> => {
      calls += 1;
      await tick();
      return 42;
    };

    const first = queue.run("same", task);
    const second = queue.run("same", task);

    assert.equal(first, second);
    assert.deepEqual(await Promise.all([first, second]), [42, 42]);
    assert.equal(calls, 1);
  });

  it("lets a duplicate caller abort its own wait without cancelling the shared job", async () => {
    const queue = new OcrJobQueue();
    const gate = deferred<void>();
    const shared = queue.run("same", async () => {
      await gate.promise;
      return 7;
    });
    const controller = new AbortController();
    const duplicate = queue.run("same", async () => {
      throw new Error("duplicate task must not run");
    }, { signal: controller.signal });
    const rejection = assert.rejects(duplicate, (error: unknown) => error instanceof OcrCancelledError);

    controller.abort();
    await rejection;
    assert.equal(queue.stats().cancelled, 1);

    gate.resolve();
    assert.equal(await shared, 7);
    assert.equal(queue.stats().completed, 1);
  });

  it("removes a queued job when its signal aborts", async () => {    const queue = new OcrJobQueue();
    const gate = deferred<void>();
    let cancelledRan = false;
    const first = queue.run("long", async () => {
      await gate.promise;
      return "first";
    });

    const controller = new AbortController();
    const cancelled = queue.run("queued", async () => {
      cancelledRan = true;
      return "cancelled";
    }, { signal: controller.signal });
    const rejection = assert.rejects(cancelled, (error: unknown) => {
      return error instanceof OcrCancelledError;
    });

    controller.abort();
    await rejection;
    assert.equal(queue.stats().queued, 0);
    assert.equal(queue.stats().cancelled, 1);

    gate.resolve();
    assert.equal(await first, "first");
    assert.equal(cancelledRan, false);
    assert.equal(queue.stats().completed, 1);
  });

  it("rejects work beyond the queue capacity", async () => {
    const queue = new OcrJobQueue({ concurrency: 1, maxQueueSize: 1 });
    const gate = deferred<void>();
    const first = queue.run("a", async () => {
      await gate.promise;
    });
    const second = queue.run("b", async () => undefined);

    await assert.rejects(queue.run("c", async () => undefined), /OCR_QUEUE_FULL/);

    gate.resolve();
    await Promise.all([first, second]);
  });

  it("counts failed jobs and reaches idle", async () => {
    const queue = new OcrJobQueue();
    await assert.rejects(queue.run("broken", async () => {
      throw new Error("engine crashed");
    }), /engine crashed/);
    await queue.onIdle();
    assert.equal(queue.stats().failed, 1);
    assert.equal(queue.stats().running, 0);
  });
});
