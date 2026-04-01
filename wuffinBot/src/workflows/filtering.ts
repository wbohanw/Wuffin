import { Workflow, z } from "@botpress/runtime";
import { runFiltering } from "../utils/runFiltering";

export const FilteringWorkflow = new Workflow({
  name: "filtering",
  description: "Rebuild FilteredJobsTable with today's jobs that match any active keyword filter",
  timeout: "10m",

  state: z.object({
    lastRunAt: z.string().optional(),
  }),

  async handler({ state, step }) {
    const today = new Date().toISOString().split("T")[0]!;

    await step("filter", async () => {
      await runFiltering();
    });

    state.lastRunAt = today;
  },
});
