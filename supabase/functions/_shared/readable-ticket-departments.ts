export type ReadableTicketDepartmentInput = {
  id: string;
  key: string;
  name: string;
};

export type ReadableTicketDepartment = {
  id: string;
  key: string;
  label: string;
};

export function readableTicketDepartments(
  departments: readonly ReadableTicketDepartmentInput[],
  accessByDepartmentId: ReadonlyMap<string, boolean>,
): ReadableTicketDepartment[] {
  return departments.flatMap((department) =>
    accessByDepartmentId.get(department.id) === true
      ? [
          {
            id: department.id,
            key: department.key,
            label: department.name,
          },
        ]
      : [],
  );
}
