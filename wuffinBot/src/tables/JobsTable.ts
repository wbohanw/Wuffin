import { Table, z } from "@botpress/runtime";

export const JobsTable = new Table({
  name: "JobsTable",
  description: "All discovered job postings across monitored career pages",
  keyColumn: "jobKey",
  columns: {
    jobKey: z.string().describe("Unique key: company + normalized title"),
    company: z.string(),
    title: z.string(),
    location: z.string().optional(),
    url: z.string().optional().describe("Direct link to job posting if found"),
    description: z.string().optional(),
    experience: z.string().optional().describe("Required experience level or years"),
    firstSeenAt: z.string().describe("ISO date first discovered"),
    lastSeenAt: z.string().describe("ISO date last confirmed active"),
  },
});
