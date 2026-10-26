export type QueueOption = readonly [key: string, label: string];

export function shouldShowQueueTabs(
  queueOptions: readonly QueueOption[],
): boolean {
  return queueOptions.length > 0;
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
