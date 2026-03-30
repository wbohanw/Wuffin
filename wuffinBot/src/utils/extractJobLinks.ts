const SKIP_DOMAINS = ["twitter.com", "linkedin.com/company", "facebook.com", "instagram.com", "youtube.com", "glassdoor.com"];

export type JobLink = {
  title: string;
  url: string;
};

export function extractJobLinks(markdown: string): JobLink[] {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const seen = new Set<string>();
  const results: JobLink[] = [];
  let match;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const title = match[1]!.replace(/\*+/g, "").trim();
    const url = match[2]!.trim();

    if (SKIP_DOMAINS.some((d) => url.includes(d))) continue;
    if (seen.has(url)) continue;

    seen.add(url);
    results.push({ title, url });
  }

  return results;
}
