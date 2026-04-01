import { LinksTable } from "../tables/LinksTable";
import { KeywordsTable } from "../tables/KeywordsTable";
import { FilteredJobsTable } from "../tables/FilteredJobsTable";

export async function runFiltering(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;

  const { rows: kwRows } = await KeywordsTable.findRows({ limit: 200 });
  const keywords = kwRows.map((r) => r.keyword.toLowerCase());

  const { rows: allLinks } = await LinksTable.findRows({ limit: 1000 });
  const todayJobs = allLinks.filter((r) => r.title && r.firstSeenAt === today);

  const filtered = keywords.length === 0
    ? todayJobs
    : todayJobs.filter((j) =>
        keywords.some((kw) => j.title!.toLowerCase().includes(kw))
      );

  console.log(`[runFiltering] ${todayJobs.length} job(s) today → ${filtered.length} after keyword filter [${keywords.join(", ") || "none — showing all"}]`);

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
