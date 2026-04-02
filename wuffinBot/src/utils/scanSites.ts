import { actions, adk, z } from "@botpress/runtime";
import { extractJobLinks } from "./extractJobLinks";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { LinksTable, ExperienceLevel, JobType } from "../tables/LinksTable";
import { DailyNewJobsTable } from "../tables/DailyNewJobsTable";
import type { ExperienceLevel as ExperienceLevelType, JobType as JobTypeType } from "../tables/LinksTable";

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

export type NewJob = {
  company: string;
  title: string;
  url: string;
  summary?: string;
  experience?: ExperienceLevelType;
  location?: string;
  jobType?: JobTypeType;
};

const JobDetails = z.object({
  isJob: z.boolean().describe("Whether this page is actually a job posting"),
  title: z.string().optional().describe("The job title in English (translate if needed)"),
  summary: z.string().optional().describe("Brief 1-2 sentence summary of the role in English (translate if needed)"),
  experienceRaw: z.string().optional().describe("Required experience as stated on the page (e.g. '5+ years', 'fresh grad', 'entry level', 'intern', 'staff engineer')"),
  location: z.string().optional().describe("Job location in 'City, State/Province, Country' format using full names (e.g. 'Toronto, Ontario, Canada' or 'Los Angeles, California, United States'). Use 'Remote' if fully remote. Leave empty if not mentioned."),
  jobType: z.string().optional().describe("Employment type: 'full-time', 'part-time', 'intern', or 'contract'. Leave empty if not mentioned."),
});

function mapExperience(raw?: string): ExperienceLevelType | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  // Staff and above: staff engineer, principal, distinguished, director, VP, C-level, head of
  if (
    s.includes("staff") || s.includes("principal") || s.includes("distinguished") ||
    s.includes("director") || s.includes("vp ") || s.includes("vice president") ||
    s.includes("head of") || s.includes("c-level") || s.includes("chief")
  ) {
    return "staff";
  }
  // Intern: explicit internship/co-op
  if (s.includes("intern") || s.includes("co-op") || s.includes("coop")) {
    return "intern";
  }
  // Senior: senior title or 3+ years experience
  if (
    s.includes("senior") || s.includes("lead") ||
    /[3-9]\d*\s*\+?\s*year/.test(s) || /3\+/.test(s)
  ) {
    return "senior";
  }
  // Entry: entry level, junior, graduate, fresh grad, 0-3 years
  if (
    s.includes("entry") || s.includes("junior") || s.includes("grad") ||
    s.includes("fresh") || s.includes("associate") || s.includes("new grad") ||
    /[0-3]\s*\+?\s*year/.test(s) || /\bless than [123]\b/.test(s) ||
    /\b[<]?\s*[123]\s*year/.test(s)
  ) {
    return "entry";
  }
  return undefined;
}

function mapJobType(raw?: string): JobTypeType | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("intern")) return "intern";
  if (s.includes("part")) return "part-time";
  if (s.includes("contract") || s.includes("freelance")) return "contract";
  if (s.includes("full")) return "full-time";
  return undefined;
}

export async function parseJobPage(url: string): Promise<{
  isJob: boolean;
  title?: string;
  summary?: string;
  experience?: ExperienceLevelType;
  location?: string;
  jobType?: JobTypeType;
}> {
  try {
    const { results } = await actions.browser.browsePages({ urls: [url], waitFor: 10000 });
    const result = results[0] as any;
    const markdown: string = result?.content ?? (typeof result === "string" ? result : JSON.stringify(result));

    const details = await adk.zai.extract(markdown, JobDetails, {
      instructions:
        "Determine if this page is a job posting. If yes, extract: (1) title and summary in English (translate if needed), (2) raw experience requirement as stated (e.g. '5+ years', 'intern', 'staff engineer', 'fresh grad'), (3) location formatted as 'City, State/Province, Country' using full names (e.g. 'Toronto, Ontario, Canada') — use 'Remote' if fully remote, leave empty if unknown, (4) employment type. If this is not a job posting (login page, homepage, job list page), set isJob to false.",
    });

    return {
      isJob: details.isJob,
      title: details.title,
      summary: details.summary,
      experience: mapExperience(details.experienceRaw),
      location: details.location,
      jobType: mapJobType(details.jobType),
    };
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
    await DailyNewJobsTable.deleteRowIds(oldDaily.map((r) => r.id));
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
          location: details.location,
          jobType: details.jobType,
          firstSeenAt: today,
          lastSeenAt: today,
          parsedAt: today,
        }],
      });

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
          location: details.location,
          jobType: details.jobType,
          url: link.url,
          foundAt: today,
        }],
      });

      newJobs.push({ company: site.company, title, url: link.url, summary: details.summary, experience: details.experience, location: details.location, jobType: details.jobType });
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

    // Store without zai — enrichLinks workflow will fill in title/summary/etc.
    await LinksTable.createRows({
      rows: [{
        jobKey,
        company,
        url: link.url,
        firstSeenAt: today,
        lastSeenAt: today,
        // parsedAt intentionally omitted so enrichLinks picks it up
      }],
    });
    seeded++;
  }

  return { seeded, links };
}
