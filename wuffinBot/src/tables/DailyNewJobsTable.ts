import { Table, z } from "@botpress/runtime";

export const DailyNewJobsTable = new Table({
  name: "DailyNewJobsTable",
  description: "Today's newly discovered job postings — cleared and repopulated on each daily scan",
  keyColumn: "jobKey",
  columns: {
    jobKey: z.string().describe("Job URL (unique identifier)"),
    company: z.string(),
    title: z.string(),
    url: z.string(),
    experience: z.string().optional(),
    summary: z.string().optional(),
    foundAt: z.string().describe("ISO date this job was first found"),
  },
});
