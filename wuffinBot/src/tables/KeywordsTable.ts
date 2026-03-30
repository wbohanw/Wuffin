import { Table, z } from "@botpress/runtime";

export const KeywordsTable = new Table({
  name: "KeywordsTable",
  description: "Keywords used to filter job alert digests",
  keyColumn: "keyword",
  columns: {
    keyword: z.string().describe("Keyword to match against job titles (case-insensitive)"),
    addedAt: z.string().describe("ISO date added"),
  },
});
