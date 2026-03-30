import { Table, z } from "@botpress/runtime";

export const WatchedSitesTable = new Table({
  name: "WatchedSitesTable",
  description: "Career page URLs to monitor for new job postings",
  keyColumn: "url",
  columns: {
    url: z.string().describe("Career page URL"),
    company: z.string().describe("Company name"),
    addedAt: z.string().describe("ISO date added"),
  },
});
