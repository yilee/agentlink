/**
 * Async message stream (producer-consumer queue).
 * Used to feed user messages into the Claude subprocess stdin.
 */
export class Stream<T> implements AsyncIterableIterator<T> {
  private queue: T[] = [];
  private readResolve?: (result: IteratorResult<T>) => void;
  private readReject?: (error: unknown) => void;
  private isDone = false;
  private hasError?: unknown;
  private started = false;

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.started) throw new Error('Stream can only be iterated once');
    this.started = true;
    return this;
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      return { done: false, value: this.queue.shift()! };
    }
    if (this.isDone) return { done: true, value: undefined as unknown as T };
    if (this.hasError) throw this.hasError;

    return new Promise((resolve, reject) => {
      this.readResolve = resolve;
      this.readReject = reject;
    });
  }

  enqueue(value: T): void {
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: false, value });
    } else {
      this.queue.push(value);
    }
  }

  done(): void {
    this.isDone = true;
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: true, value: undefined as unknown as T });
    }
  }

  error(err: unknown): void {
    this.hasError = err;
    if (this.readReject) {
      const reject = this.readReject;
      this.readResolve = undefined;
      this.readReject = undefined;
      reject(err);
    }
  }

  async return(): Promise<IteratorResult<T>> {
    this.isDone = true;
    return { done: true, value: undefined as unknown as T };
  }
}
