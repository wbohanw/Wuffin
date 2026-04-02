import { Table, z } from "@botpress/runtime";

export const SubscribersTable = new Table({
  name: "SubscribersTable",
  description: "Users registered via DM to receive personal job digests",
  keyColumn: "dmChannelId",
  columns: {
    dmChannelId: z.string().describe("Discord DM channel ID (unique per user)"),
    discordUserId: z.string().describe("Discord user ID (from message tags)"),
    keywords: z.string().describe("Comma-separated title keyword filters (empty = all jobs)"),
    locations: z.string().describe("Comma-separated location filters, partial match against City/State/Country (empty = all locations)"),
    experienceLevels: z.string().describe("Comma-separated experience level filters: intern, entry, senior, staff (empty = all levels)"),
    registeredAt: z.string().describe("ISO timestamp of registration"),
  },
});
