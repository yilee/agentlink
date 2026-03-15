import { describe, it, expect } from 'vitest';
import { MessageRelay } from '../../server/src/message-relay.js';

describe('MessageRelay', () => {
  it('processes messages in order for the same ID', async () => {
    const relay = new MessageRelay();
    const order: number[] = [];

    relay.enqueue('a', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    relay.enqueue('a', async () => {
      order.push(2);
    });
    relay.enqueue('a', async () => {
      order.push(3);
    });

    // Wait for all to complete
    await new Promise((r) => setTimeout(r, 100));
    expect(order).toEqual([1, 2, 3]);
  });

  it('processes different IDs concurrently', async () => {
    const relay = new MessageRelay();
    const order: string[] = [];

    relay.enqueue('a', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push('a');
    });
    relay.enqueue('b', async () => {
      order.push('b');
    });

    await new Promise((r) => setTimeout(r, 100));
    // 'b' should complete before 'a' since it has no delay
    expect(order).toEqual(['b', 'a']);
  });

  it('continues processing after handler error', async () => {
    const relay = new MessageRelay();
    const order: number[] = [];

    relay.enqueue('a', async () => {
      order.push(1);
      throw new Error('fail');
    });
    relay.enqueue('a', async () => {
      order.push(2);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([1, 2]);
  });

  it('cleanup removes the queue for an ID', async () => {
    const relay = new MessageRelay();
    const order: number[] = [];

    relay.enqueue('a', async () => {
      order.push(1);
    });
    relay.cleanup('a');

    // Enqueue again — should work on a fresh queue
    relay.enqueue('a', async () => {
      order.push(2);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([1, 2]);
  });
});
