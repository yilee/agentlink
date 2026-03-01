import { describe, it, expect } from 'vitest';
import { Stream } from '../../agent/src/stream.js';

describe('Stream', () => {
  it('yields buffered values', async () => {
    const s = new Stream<number>();
    s.enqueue(1);
    s.enqueue(2);
    s.enqueue(3);
    s.done();

    const values: number[] = [];
    for await (const v of s) {
      values.push(v);
    }
    expect(values).toEqual([1, 2, 3]);
  });

  it('resolves pending read when value is enqueued', async () => {
    const s = new Stream<string>();
    const iter = s[Symbol.asyncIterator]();

    const pending = iter.next();
    s.enqueue('hello');
    const result = await pending;
    expect(result).toEqual({ done: false, value: 'hello' });

    s.done();
  });

  it('signals done to pending reader', async () => {
    const s = new Stream<number>();
    const iter = s[Symbol.asyncIterator]();

    const pending = iter.next();
    s.done();
    const result = await pending;
    expect(result.done).toBe(true);
  });

  it('returns done after done() called', async () => {
    const s = new Stream<number>();
    const iter = s[Symbol.asyncIterator]();
    s.done();
    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  it('rejects pending read on error()', async () => {
    const s = new Stream<number>();
    const iter = s[Symbol.asyncIterator]();

    const pending = iter.next();
    s.error(new Error('boom'));
    await expect(pending).rejects.toThrow('boom');
  });

  it('throws on next() after error() with no pending reader', async () => {
    const s = new Stream<number>();
    const iter = s[Symbol.asyncIterator]();
    s.error(new Error('fail'));
    await expect(iter.next()).rejects.toThrow('fail');
  });

  it('prevents double iteration', () => {
    const s = new Stream<number>();
    s[Symbol.asyncIterator]();
    expect(() => s[Symbol.asyncIterator]()).toThrow('Stream can only be iterated once');
  });

  it('return() marks stream as done', async () => {
    const s = new Stream<number>();
    const iter = s[Symbol.asyncIterator]();
    s.enqueue(1);
    const r = await iter.return!();
    expect(r.done).toBe(true);
    // Buffered value is still drained, then done
    const next1 = await iter.next();
    expect(next1).toEqual({ done: false, value: 1 });
    const next2 = await iter.next();
    expect(next2.done).toBe(true);
  });

  it('handles mixed enqueue and read', async () => {
    const s = new Stream<number>();
    const iter = s[Symbol.asyncIterator]();

    s.enqueue(1);
    expect(await iter.next()).toEqual({ done: false, value: 1 });

    const p = iter.next();
    s.enqueue(2);
    expect(await p).toEqual({ done: false, value: 2 });

    s.enqueue(3);
    s.done();
    expect(await iter.next()).toEqual({ done: false, value: 3 });
    expect((await iter.next()).done).toBe(true);
  });
});
