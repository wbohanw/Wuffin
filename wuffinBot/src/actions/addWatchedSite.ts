import { Action, z } from "@botpress/runtime";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";

export const addWatchedSite = new Action({
  name: "addWatchedSite",
  description: "Add a company career page to the monitoring watchlist",
  input: z.object({
    url: z.string().describe("Full career page URL"),
    company: z.string().describe("Company name"),
  }),
  output: z.object({
    added: z.boolean(),
    message: z.string(),
  }),

  async handler({ input }) {
    await WatchedSitesTable.upsertRows({
      rows: [
        {
          url: input.url,
          company: input.company,
          addedAt: new Date().toISOString(),
        },
      ],
      keyColumn: "url",
    });

    return {
      added: true,
      message: `Now monitoring ${input.company} at ${input.url}`,
    };
  },
});
