import { LinksTable } from "../tables/LinksTable";
import { FilteredJobsTable } from "../tables/FilteredJobsTable";

export async function runFiltering(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;

  const { rows: allLinks } = await LinksTable.findRows({ limit: 1000 });
  const filtered = allLinks.filter((r) => r.title && r.firstSeenAt === today);

  console.log(`[runFiltering] ${filtered.length} job(s) today`);

  const { rows: existing } = await FilteredJobsTable.findRows({ limit: 1000 });
  if (existing.length > 0) {
    await FilteredJobsTable.deleteRowIds(existing.map((r) => r.id));
  }

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
}
