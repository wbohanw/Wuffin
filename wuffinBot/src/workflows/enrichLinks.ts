import { Workflow, z } from "@botpress/runtime";
import { LinksTable } from "../tables/LinksTable";
import { parseJobPage } from "../utils/scanSites";

export const EnrichLinksWorkflow = new Workflow({
  name: "enrichLinks",
  description: "Enrich LinksTable rows that were seeded without zai parsing — fills in title, summary, experience, location, jobType",
  schedule: "30 9 * * *", // 30 min after daily digest (09:00)
  timeout: "2h",

  state: z.object({
    lastRunAt: z.string().optional(),
  }),

  async handler({ state, step }) {
    const today = new Date().toISOString().split("T")[0]!;

    await step("enrich", async () => {
      const { rows } = await LinksTable.findRows({ limit: 1000 });

      const unenriched = rows.filter((r) => !r.parsedAt);
      console.log(`[enrichLinks] ${unenriched.length} link(s) need enrichment out of ${rows.length} total`);

      for (const row of unenriched) {
        // Row already has a title (from a prior scan before parsedAt was added) — just stamp it
        if (row.title) {
          await LinksTable.updateRows({ rows: [{ id: row.id, parsedAt: today }] });
          console.log(`[enrichLinks] stamped existing title for ${row.url}`);
          continue;
        }

        console.log(`[enrichLinks] parsing ${row.company} — ${row.url}`);
        const details = await parseJobPage(row.url);
        const title = details.isJob ? (details.title ?? "") : "";

        await LinksTable.updateRows({
          rows: [{
            id: row.id,
            title: title || undefined,
            summary: details.summary,
            experience: details.experience,
            location: details.location,
            jobType: details.jobType,
            parsedAt: today,
          }],
        });

        console.log(`[enrichLinks] ${row.url} → isJob=${details.isJob}, title="${title}"`);
      }
    });

    state.lastRunAt = today;
  },
});
