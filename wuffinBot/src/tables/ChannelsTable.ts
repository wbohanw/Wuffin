import { Table, z } from "@botpress/runtime";

export const ChannelsTable = new Table({
  name: "ChannelsTable",
  description: "Registered Discord channels and their types (add-link, insight, etc.)",
  keyColumn: "channelId",
  columns: {
    channelId: z.string().describe("Discord channel ID"),
    channelType: z.string().describe("Channel role: add-link, insight, ..."),
    registeredAt: z.string().describe("ISO timestamp of registration"),
  },
});
