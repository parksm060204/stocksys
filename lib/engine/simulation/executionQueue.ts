/** Serializes async simulation mutations and keeps the queue usable after failures. */
export class SerialExecutionQueue {
  private tail: Promise<void> = Promise.resolve();

  public run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
