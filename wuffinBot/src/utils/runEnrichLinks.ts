import { LinksTable } from "../tables/LinksTable";
import { parseJobPage } from "./scanSites";

export async function runEnrichLinks(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;

  const { rows } = await LinksTable.findRows({ limit: 1000 });
  const unenriched = rows.filter((r) => !r.parsedAt);

  console.log(`[runEnrichLinks] ${unenriched.length} link(s) need enrichment out of ${rows.length} total`);

  for (const row of unenriched) {
    if (row.title) {
      await LinksTable.updateRows({ rows: [{ id: row.id, parsedAt: today }] });
      console.log(`[runEnrichLinks] stamped existing title for ${row.url}`);
      continue;
    }

    console.log(`[runEnrichLinks] parsing ${row.company} — ${row.url}`);
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

    console.log(`[runEnrichLinks] ${row.url} → isJob=${details.isJob}, title="${title}"`);
  }
}
