import { Table, z } from "@botpress/runtime";

export const LinksTable = new Table({
  name: "LinksTable",
  description: "All discovered links from monitored career pages. title is empty if zai could not confirm it is a real job posting.",
  keyColumn: "jobKey",
  columns: {
    jobKey: z.string().describe("Job URL (unique identifier)"),
    company: z.string(),
    url: z.string(),
    title: z.string().optional().describe("Job title extracted by zai — empty means invalid/not a job"),
    summary: z.string().optional().describe("Brief description of the role"),
    experience: z.string().optional().describe("Required experience level or years"),
    firstSeenAt: z.string().describe("ISO date first discovered"),
    lastSeenAt: z.string().describe("ISO date last confirmed active"),
  },
});
