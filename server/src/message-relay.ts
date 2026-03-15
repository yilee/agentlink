/**
 * Per-ID ordered message relay queue.
 * Guarantees messages for the same ID are processed sequentially,
 * preventing out-of-order delivery caused by async encryption/compression.
 */
export class MessageRelay {
  private queues = new Map<string, Promise<void>>();

  /**
   * Enqueue a message handler for the given ID.
   * Handlers for the same ID execute in order; different IDs run concurrently.
   */
  enqueue(id: string, handler: () => Promise<void>): void {
    const prev = this.queues.get(id) || Promise.resolve();
    this.queues.set(id, prev.then(handler).catch(() => {}));
  }

  /**
   * Remove the queue for the given ID (call on disconnect).
   */
  cleanup(id: string): void {
    this.queues.delete(id);
  }
}
