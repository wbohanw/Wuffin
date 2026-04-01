import { FilteredJobsTable } from "../tables/FilteredJobsTable";

type Job = {
  company: string;
  title: string;
  url: string;
};

export function buildChunksFromJobs(jobs: Job[]): string[] {
  if (jobs.length === 0) return ["No new jobs found today."];

  const byCompany = new Map<string, Job[]>();
  for (const job of jobs) {
    const list = byCompany.get(job.company) ?? [];
    list.push(job);
    byCompany.set(job.company, list);
  }

  let msg = `New jobs found: ${jobs.length}\n\n`;
  for (const [company, companyJobs] of byCompany) {
    msg += `**${company}:**\n`;
    for (const job of companyJobs) {
      msg += `${job.title}: <${job.url}>\n`;
    }
    msg += "\n";
  }

  return splitIntoChunks(msg.trimEnd(), 2000);
}

export async function buildInsightChunks(): Promise<string[]> {
  const { rows } = await FilteredJobsTable.findRows({ limit: 500 });
  return buildChunksFromJobs(rows);
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const cut = remaining.lastIndexOf("\n", maxLen);
    const splitAt = cut > 0 ? cut : maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
