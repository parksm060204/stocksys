/**
 * Per-account async locks for local trading settlement.
 *
 * Every caller acquires account locks in the same sorted order. This keeps
 * concurrent orders for unrelated accounts independent while preventing two
 * stocks from spending or mutating the same user's assets concurrently.
 *
 * Supports safe re-entrancy when an outer scope already holds a superset
 * of the requested account IDs (via AsyncLocalStorage).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const accountLocks = new Map<string, Promise<void>>();
const heldAccountLocksStorage = new AsyncLocalStorage<ReadonlySet<string>>();

function acquireAccountLock(accountId: string): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const previous = accountLocks.get(accountId) ?? Promise.resolve();
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  const queued = previous.then(() => next);
  accountLocks.set(accountId, queued);
  return {
    wait: previous,
    release: () => {
      release();
      if (accountLocks.get(accountId) === queued) accountLocks.delete(accountId);
    },
  };
}

/**
 * Run a trading operation while holding all requested account locks.
 * Account IDs are deduplicated and sorted before acquisition to prevent
 * deadlocks when two trades involve the same users in opposite roles.
 */
export async function withAccountLocks<T>(
  accountIds: Iterable<string>,
  operation: () => Promise<T>
): Promise<T> {
  const ids = [...new Set([...accountIds].filter(Boolean))].sort();
  if (ids.length === 0) {
    return await operation();
  }

  const alreadyHeld = heldAccountLocksStorage.getStore();
  if (alreadyHeld && alreadyHeld.size > 0) {
    const missing = ids.filter((id) => !alreadyHeld.has(id));
    if (missing.length === 0) {
      return await operation();
    }
    throw new Error(
      `[withAccountLocks] Lock ordering violation: cannot acquire [${missing.join(', ')}] while holding [${Array.from(alreadyHeld).join(', ')}]`
    );
  }

  const acquired: Array<{ release: () => void }> = [];

  try {
    for (const id of ids) {
      const lock = acquireAccountLock(id);
      await lock.wait;
      acquired.push({ release: lock.release });
    }

    return await heldAccountLocksStorage.run(new Set(ids), operation);
  } finally {
    for (let i = acquired.length - 1; i >= 0; i -= 1) {
      acquired[i].release();
    }
  }
}
