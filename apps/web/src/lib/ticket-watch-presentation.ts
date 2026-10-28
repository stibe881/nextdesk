export type TicketWatchPresentation = {
  actionLabel: string;
  icon: "eye" | "eye-off";
  label: string;
};

export function ticketWatchPresentation(
  watching: boolean,
): TicketWatchPresentation {
  return watching
    ? {
        actionLabel: "Ticket nicht mehr beobachten",
        icon: "eye",
        label: "Nicht mehr beobachten",
      }
    : {
        actionLabel: "Ticket beobachten",
        icon: "eye-off",
        label: "Beobachten",
      };
}
