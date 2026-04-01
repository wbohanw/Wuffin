import { Workflow, z } from "@botpress/runtime";
import { runEnrichLinks } from "../utils/runEnrichLinks";

export const EnrichLinksWorkflow = new Workflow({
  name: "enrichLinks",
  description: "Enrich LinksTable rows that were seeded without zai parsing — fills in title, summary, experience, location, jobType",
  schedule: "30 9 * * *",
  timeout: "2h",

  state: z.object({
    lastRunAt: z.string().optional(),
  }),

  async handler({ state, step }) {
    const today = new Date().toISOString().split("T")[0]!;

    await step("enrich", async () => {
      await runEnrichLinks();
    });

    state.lastRunAt = today;
  },
});
