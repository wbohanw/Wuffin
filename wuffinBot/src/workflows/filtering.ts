import { Workflow, z } from "@botpress/runtime";
import { LinksTable } from "../tables/LinksTable";
import { KeywordsTable } from "../tables/KeywordsTable";
import { FilteredJobsTable } from "../tables/FilteredJobsTable";

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
      // Load keywords
      const { rows: kwRows } = await KeywordsTable.findRows({ limit: 200 });
      const keywords = kwRows.map((r) => r.keyword.toLowerCase());

      // Get today's valid jobs from LinksTable
      const { rows: allLinks } = await LinksTable.findRows({ limit: 1000 });
      const todayJobs = allLinks.filter(
        (r) => r.title && r.firstSeenAt === today
      );

      // Apply keyword filter (if no keywords set, include all today's jobs)
      const filtered = keywords.length === 0
        ? todayJobs
        : todayJobs.filter((j) =>
            keywords.some((kw) => j.title!.toLowerCase().includes(kw))
          );

      console.log(
        `[filtering] ${todayJobs.length} job(s) today → ${filtered.length} match keyword filter [${keywords.join(", ") || "none — showing all"}]`
      );

      // Clear existing rows
      const { rows: existing } = await FilteredJobsTable.findRows({ limit: 1000 });
      if (existing.length > 0) {
        await FilteredJobsTable.deleteRowIds(existing.map((r) => r.id));
      }

      // Insert filtered jobs
      if (filtered.length > 0) {
        await FilteredJobsTable.createRows({
          rows: filtered.map((j) => ({
            jobKey: j.jobKey,
            company: j.company,
            title: j.title!,
            url: j.url,
            experience: j.experience,
            location: j.location,
            jobType: j.jobType,
            summary: j.summary,
            firstSeenAt: j.firstSeenAt,
          })),
        });
      }

      console.log(`[filtering] FilteredJobsTable updated with ${filtered.length} job(s)`);
    });

    state.lastRunAt = today;
  },
});
