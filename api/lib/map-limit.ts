/**
 * Run `fn` over `items` with at most `limit` calls in flight, returning the
 * results in input order. Rejects with the first error; calls already in
 * flight finish, but no new ones start.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const runOne = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, runOne);
  await Promise.all(runners);
  return results;
}
