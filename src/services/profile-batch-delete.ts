export interface BatchDeleteFailure {
  id: string;
  error: unknown;
}

export interface BatchDeleteResult {
  succeeded: string[];
  failed: BatchDeleteFailure[];
}

/** Each target has its own confirmed outcome; a rejected target remains retryable. */
export async function deleteProfileItems(
  targets: readonly string[],
  deleteItem: (id: string) => Promise<void>,
): Promise<BatchDeleteResult> {
  const result: BatchDeleteResult = { succeeded: [], failed: [] };
  for (const id of new Set(targets)) {
    try {
      await deleteItem(id);
      result.succeeded.push(id);
    } catch (error) {
      result.failed.push({ id, error });
    }
  }
  return result;
}

/** Do not clear failed targets or selections added after the operation started. */
export function removeDeletedSelection(
  selected: ReadonlySet<string>,
  succeeded: readonly string[],
): Set<string> {
  const next = new Set(selected);
  for (const id of succeeded) next.delete(id);
  return next;
}
