/**
 * A tiny async queue so tool events and stream events leave `runAssistant`
 * in the order they happen. `push` never waits; the iterator waits only
 * when the buffer is empty.
 */

export type EventQueue<T> = {
  push(item: T): void;
  close(): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
};

export function createEventQueue<T>(): EventQueue<T> {
  const pending: T[] = [];
  let closed = false;
  let notify: (() => void) | null = null;

  function wake(): void {
    const resolve = notify;
    notify = null;
    resolve?.();
  }

  return {
    push(item) {
      if (closed) return;
      pending.push(item);
      wake();
    },
    close() {
      if (closed) return;
      closed = true;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = pending.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          if (pending.length > 0 || closed) resolve();
          else notify = resolve;
        });
      }
    },
  };
}
