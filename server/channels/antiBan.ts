// Central anti-ban guard. Every outgoing DM and public comment reply of the open-source
// adapters goes through here: sends per account are serialized, DMs get a randomized
// "typing" delay, and public comment replies keep a randomized gap between each other.
export const DM_DELAY_MS = { min: 3000, max: 6000 };
export const COMMENT_GAP_MS = { min: 15_000, max: 30_000 };

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(key, run);
  void run.finally(() => {
    if (queues.get(key) === run) queues.delete(key);
  }).catch(() => undefined);
  return run;
}

/** Sends a DM after a randomized 3-6s typing delay; `typing` (if any) is fired first. */
export function guardedDm<T>(accountKey: string, send: () => Promise<T>, typing?: () => Promise<void>): Promise<T> {
  return enqueue(`dm:${accountKey}`, async () => {
    try {
      await typing?.();
    } catch {
      // presence is cosmetic
    }
    await sleep(randomBetween(DM_DELAY_MS.min, DM_DELAY_MS.max));
    return send();
  });
}

const lastCommentAt = new Map<string, number>();

/** Posts a public comment reply at least 15-30s (random) after the previous one on this account. */
export function guardedComment<T>(accountKey: string, send: () => Promise<T>): Promise<T> {
  return enqueue(`comment:${accountKey}`, async () => {
    const last = lastCommentAt.get(accountKey);
    if (last) {
      const wait = last + randomBetween(COMMENT_GAP_MS.min, COMMENT_GAP_MS.max) - Date.now();
      if (wait > 0) await sleep(wait);
    }
    try {
      return await send();
    } finally {
      lastCommentAt.set(accountKey, Date.now());
    }
  });
}

/** Random pause used by listeners before handing a message to the agent (human-like read time). */
export const humanPause = (min = 3000, max = 5000) => sleep(randomBetween(min, max));
