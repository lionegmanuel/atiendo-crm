import { z } from "zod";

export const pingSchema = z.object({
  ping: z.literal("pong"),
});

export type Ping = z.infer<typeof pingSchema>;
