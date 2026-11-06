export type QueueOption = readonly [key: string, label: string];

export function shouldShowQueueTabs(
  queueOptions: readonly QueueOption[],
): boolean {
  // Only agents who work in several departments choose between queues.
  return queueOptions.length > 1;
}

export function normalizeQueueSelection(
  queue: string,
  queueOptions: readonly QueueOption[],
): string {
  if (
    queue === "alle" ||
    queueOptions.some(([queueKey]) => queueKey === queue)
  ) {
    return queue;
  }

  return "alle";
}
