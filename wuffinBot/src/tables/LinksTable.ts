import { Table, z } from "@botpress/runtime";

export const ExperienceLevel = z.enum(["entry", "junior", "senior"]).describe(
  "entry = <1 yr, junior = 1-3 yrs, senior = 3+ yrs"
);
export type ExperienceLevel = z.infer<typeof ExperienceLevel>;

export const JobType = z.enum(["full-time", "part-time", "intern", "contract"]);
export type JobType = z.infer<typeof JobType>;

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
    experience: ExperienceLevel.optional().describe("Normalized experience tier"),
    location: z.string().optional().describe("Job location or Remote"),
    jobType: JobType.optional().describe("Employment type"),
    firstSeenAt: z.string().describe("ISO date first discovered"),
    lastSeenAt: z.string().describe("ISO date last confirmed active"),
    parsedAt: z.string().optional().describe("ISO date zai last ran on this link — empty means not yet enriched"),
  },
});
