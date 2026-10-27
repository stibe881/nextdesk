export type TimestampedTicketComment = {
  created_at: string;
  id: string;
};

export function chronologicalTicketComments<T extends TimestampedTicketComment>(
  comments: readonly T[],
): T[] {
  return [...comments].sort((left, right) => {
    const createdAtDifference =
      Date.parse(left.created_at) - Date.parse(right.created_at);
    return createdAtDifference || left.id.localeCompare(right.id);
  });
}
