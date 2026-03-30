import { actions, adk, z } from "@botpress/runtime";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { JobsTable } from "../tables/JobsTable";
import { DailyNewJobsTable } from "../tables/DailyNewJobsTable";
import { extractJobLinks } from "./extractJobLinks";

export type NewJob = {
  company: string;
  title: string;
  url: string;
  description?: string;
  experience?: string;
};

const JobDetails = z.object({
  isJob: z.boolean().describe("Whether this page is actually a job posting"),
  title: z.string().describe("The job title as shown on the page"),
  description: z.string().optional().describe("Brief summary of the role"),
  experience: z.string().optional().describe("Required experience level or years (e.g. '3+ years', 'Entry level')"),
});

async function parseJobPage(url: string): Promise<{ isJob: boolean; title?: string; description?: string; experience?: string }> {
  try {
    const { results } = await actions.browser.browsePages({ urls: [url], waitFor: 10000 });
    const result = results[0] as any;
    const markdown: string = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));

    const details = await adk.zai.extract(markdown, JobDetails, {
      instructions: "Determine if this page is a job posting. If yes, extract the job title, a brief description of the role, and the required experience. If this is not a job posting (e.g. it's a login page, homepage, or unrelated page), set isJob to false.",
    });

    return details;
  } catch (err) {
    console.error(`[parseJobPage] Failed for ${url}:`, String(err));
    return { isJob: false };
  }
}

export async function scanSites(): Promise<{ newJobs: NewJob[]; sitesScanned: number }> {
  const today = new Date().toISOString().split("T")[0]!;

  // Clear yesterday's daily jobs
  const { rows: oldDaily } = await DailyNewJobsTable.findRows({ limit: 500 });
  if (oldDaily.length > 0) {
    await DailyNewJobsTable.deleteRows({ ids: oldDaily.map((r) => r.id) });
  }

  const { rows: sites } = await WatchedSitesTable.findRows({ limit: 100 });

  console.log(`[scanSites] ${sites.length} site(s) in watchlist`);
  if (sites.length === 0) return { newJobs: [], sitesScanned: 0 };

  const newJobs: NewJob[] = [];

  for (const site of sites) {
    console.log(`[scanSites] fetching ${site.company} — ${site.url}`);

    let markdown: string | undefined;
    try {
      const { results } = await actions.browser.browsePages({ urls: [site.url], waitFor: 30000 });
      const result = results[0] as any;
      markdown = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));
    } catch (err) {
      console.error(`[scanSites] Failed to fetch ${site.company}:`, String(err));
      continue;
    }

    if (!markdown) continue;

    const links = extractJobLinks(markdown);
    console.log(`[scanSites] ${site.company} — ${links.length} link(s) extracted`);

    for (const link of links) {
      const jobKey = link.url;
      const { rows: existing } = await JobsTable.findRows({ filter: { jobKey }, limit: 1 });

      // Already in table (job or SKIP) — just update lastSeenAt
      if (existing.length > 0) {
        await JobsTable.updateRows({ rows: [{ id: existing[0].id, lastSeenAt: today }] });
        continue;
      }

      // New link — parse the job page
      console.log(`[scanSites] parsing new link: ${link.url}`);
      const details = await parseJobPage(link.url);

      if (!details.isJob) {
        // Not a job — store with SKIP prefix so we never fetch it again
        await JobsTable.createRows({
          rows: [{
            jobKey,
            company: site.company,
            title: `SKIP:${link.title}`,
            url: link.url,
            firstSeenAt: today,
            lastSeenAt: today,
          }],
        });
        console.log(`[scanSites] skipped non-job: ${link.url}`);
        continue;
      }

      // Real job — store with extracted details
      const jobTitle = details.title ?? link.title;
      await JobsTable.createRows({
        rows: [{
          jobKey,
          company: site.company,
          title: jobTitle,
          description: details.description,
          experience: details.experience,
          url: link.url,
          firstSeenAt: today,
          lastSeenAt: today,
        }],
      });

      await DailyNewJobsTable.createRows({
        rows: [{
          jobKey,
          company: site.company,
          title: jobTitle,
          description: details.description,
          experience: details.experience,
          url: link.url,
          foundAt: today,
        }],
      });

      newJobs.push({
        company: site.company,
        title: jobTitle,
        url: link.url,
        description: details.description,
        experience: details.experience,
      });
    }
  }

  return { newJobs, sitesScanned: sites.length };
}

export async function seedSite(company: string, url: string): Promise<number> {
  const today = new Date().toISOString().split("T")[0]!;

  let markdown: string | undefined;
  try {
    const { results } = await actions.browser.browsePages({ urls: [url], waitFor: 30000 });
    const result = results[0] as any;
    markdown = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));
  } catch (err) {
    console.error(`[seedSite] Failed to fetch ${company}:`, String(err));
    return 0;
  }

  if (!markdown) return 0;

  const links = extractJobLinks(markdown);
  console.log(`[seedSite] ${company} — ${links.length} link(s) extracted`);
  if (links.length > 0) {
    console.log(`[seedSite] sample links:\n${links.slice(0, 5).map((l) => `  "${l.title}" → ${l.url}`).join("\n")}`);
  } else {
    console.log(`[seedSite] markdown preview:\n${markdown.slice(0, 1000)}`);
  }

  let seeded = 0;

  for (const link of links) {
    const jobKey = link.url;
    const { rows: existing } = await JobsTable.findRows({ filter: { jobKey }, limit: 1 });
    if (existing.length > 0) continue; // already known

    console.log(`[seedSite] parsing: "${link.title}" → ${link.url}`);
    const details = await parseJobPage(link.url);
    console.log(`[seedSite] result: isJob=${details.isJob}, title="${details.title}"`);

    if (!details.isJob) {
      await JobsTable.createRows({
        rows: [{
          jobKey,
          company,
          title: `SKIP:${link.title}`,
          url: link.url,
          firstSeenAt: today,
          lastSeenAt: today,
        }],
      });
      continue;
    }

    await JobsTable.createRows({
      rows: [{
        jobKey,
        company,
        title: details.title ?? link.title,
        description: details.description,
        experience: details.experience,
        url: link.url,
        firstSeenAt: today,
        lastSeenAt: today,
      }],
    });
    seeded++;
  }

  return seeded;
}
