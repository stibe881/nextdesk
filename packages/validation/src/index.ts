import { z } from "zod";

export const ticketCreateSchema = z
  .object({
    tenantId: z.string().uuid(),
    departmentId: z.string().uuid(),
    subject: z.string().trim().min(3).max(240),
    description: z.string().trim().min(1).max(50_000),
    categoryId: z.string().uuid().optional(),
    affectedUserId: z.string().uuid().optional(),
    urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    impact: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  })
  .strict();

export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

export const tenantDomainSchema = z
  .object({
    hostname: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
      ),
    isPrimary: z.boolean().default(false),
  })
  .strict();
