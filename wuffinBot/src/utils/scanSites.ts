import { actions, adk, z } from "@botpress/runtime";
import { extractJobLinks } from "./extractJobLinks";

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { LinksTable } from "../tables/LinksTable";
import { DailyNewJobsTable } from "../tables/DailyNewJobsTable";

export type NewJob = {
  company: string;
  title: string;
  url: string;
  summary?: string;
  experience?: string;
};

const JobDetails = z.object({
  isJob: z.boolean().describe("Whether this page is actually a job posting"),
  title: z.string().optional().describe("The job title as shown on the page"),
  summary: z.string().optional().describe("Brief summary of the role"),
  experience: z.string().optional().describe("Required experience level or years (e.g. '3+ years', 'Entry level')"),
});

async function parseJobPage(url: string): Promise<{ isJob: boolean; title?: string; summary?: string; experience?: string }> {
  try {
    const { results } = await actions.browser.browsePages({ urls: [url], waitFor: 10000 });
    const result = results[0] as any;
    const markdown: string = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));

    const details = await adk.zai.extract(markdown, JobDetails, {
      instructions: "Determine if this page is a job posting. If yes, extract the job title, a brief summary of the role, and the required experience. If this is not a job posting (e.g. it's a login page, homepage, or unrelated page), set isJob to false and leave other fields empty.",
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
      const { results } = await actions.browser.browsePages({ urls: [site.url], waitFor: 10000, timeout: 30000 });
      const result = results[0] as any;
      markdown = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));
    } catch (err) {
      console.error(`[scanSites] Failed to fetch ${site.company}:`, String(err));
      continue;
    }

    if (!markdown) {
      console.log(`[scanSites] empty markdown for ${site.company}`);
      continue;
    }

    console.log(`[scanSites] full markdown for ${site.company}:\n${markdown}`);

    const rawLinks = extractJobLinks(markdown);
    const links = rawLinks.map((l) => ({ title: l.title, url: resolveUrl(l.url, site.url) }));
    console.log(`[scanSites] ${site.company} — ${links.length} link(s) extracted`);

    for (const link of links) {
      const jobKey = link.url;
      const { rows: existing } = await LinksTable.findRows({ filter: { jobKey }, limit: 1 });

      // Already in table — update lastSeenAt only
      if (existing.length > 0) {
        await LinksTable.updateRows({ rows: [{ id: existing[0].id, lastSeenAt: today }] });
        continue;
      }

      // New link — parse the job page with zai
      console.log(`[scanSites] parsing new link: ${link.url}`);
      const details = await parseJobPage(link.url);

      const title = details.isJob ? (details.title ?? "") : "";

      await LinksTable.createRows({
        rows: [{
          jobKey,
          company: site.company,
          url: link.url,
          title: title || undefined,
          summary: details.summary,
          experience: details.experience,
          firstSeenAt: today,
          lastSeenAt: today,
        }],
      });

      // Only report jobs where zai confirmed a valid title
      if (!title) {
        console.log(`[scanSites] invalid/non-job link stored: ${link.url}`);
        continue;
      }

      await DailyNewJobsTable.createRows({
        rows: [{
          jobKey,
          company: site.company,
          title,
          summary: details.summary,
          experience: details.experience,
          url: link.url,
          foundAt: today,
        }],
      });

      newJobs.push({
        company: site.company,
        title,
        url: link.url,
        summary: details.summary,
        experience: details.experience,
      });
    }
  }

  return { newJobs, sitesScanned: sites.length };
}

export async function seedSite(company: string, url: string): Promise<{ seeded: number; links: { title: string; url: string }[] }> {
  const today = new Date().toISOString().split("T")[0]!;

  let markdown: string | undefined;
  try {
    const { results } = await actions.browser.browsePages({ urls: [url], waitFor: 10000, timeout: 30000 });
    const result = results[0] as any;
    markdown = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));
  } catch (err) {
    console.error(`[seedSite] Failed to fetch ${company}:`, String(err));
    return { seeded: 0, links: [] };
  }

  if (!markdown) {
    console.log(`[seedSite] empty markdown for ${company}`);
    return { seeded: 0, links: [] };
  }

  console.log(`[seedSite] full markdown for ${company}:\n${markdown}`);

  const rawLinks = extractJobLinks(markdown);
  const links = rawLinks.map((l) => ({ title: l.title, url: resolveUrl(l.url, url) }));
  console.log(`[seedSite] ${company} — ${links.length} link(s) extracted`);

  let seeded = 0;

  for (const link of links) {
    const jobKey = link.url;
    const { rows: existing } = await LinksTable.findRows({ filter: { jobKey }, limit: 1 });
    if (existing.length > 0) continue;

    // Store link immediately — no zai during seed (fast)
    // Daily scan will parse truly new links and populate title/summary
    await LinksTable.createRows({
      rows: [{
        jobKey,
        company,
        url: link.url,
        firstSeenAt: today,
        lastSeenAt: today,
      }],
    });
    seeded++;
  }

  return { seeded, links };
}
