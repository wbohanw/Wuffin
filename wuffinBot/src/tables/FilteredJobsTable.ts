import { Table, z } from "@botpress/runtime";
import { ExperienceLevel, JobType } from "./LinksTable";

export const FilteredJobsTable = new Table({
  name: "FilteredJobsTable",
  description: "Today's keyword-filtered jobs — cleared and repopulated by the FilteringWorkflow",
  keyColumn: "jobKey",
  columns: {
    jobKey: z.string().describe("Job URL (unique identifier)"),
    company: z.string(),
    title: z.string(),
    url: z.string(),
    experience: ExperienceLevel.optional(),
    location: z.string().optional(),
    jobType: JobType.optional(),
    summary: z.string().optional(),
    firstSeenAt: z.string(),
  },
});
