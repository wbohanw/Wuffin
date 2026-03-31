import { Workflow, z, bot } from "@botpress/runtime";
import { KeywordsTable } from "../tables/KeywordsTable";
import { scanSites, type NewJob } from "../utils/scanSites";
import { sendDiscordMessage } from "../utils/discordApi";

export const DailyJobDigestWorkflow = new Workflow({
  name: "dailyJobDigest",
  description: "Scan career pages and send a keyword-filtered daily digest to Discord",
  schedule: "0 9 * * *",
  timeout: "2h",

  state: z.object({
    lastRunAt: z.string().optional(),
  }),

  async handler({ state, step }) {
    const today = new Date().toISOString().split("T")[0]!;
    const channelId = bot.state.discordInsightsChannelId;

    if (!channelId) {
      console.log("[dailyJobDigest] No Discord channel ID saved — send any message in #general first.");
      return;
    }

    const sendMessage = async (text: string) => {
      await sendDiscordMessage(channelId, text);
    };

    const { newJobs, sitesScanned } = await step("scan", async () => {
      return await scanSites();
    });

    await step("send-digest", async () => {
      // Load keywords for filtering
      const { rows: kwRows } = await KeywordsTable.findRows({ limit: 200 });
      const keywords = kwRows.map((r) => r.keyword.toLowerCase());

      // Filter by keywords if any are set
      const filtered = keywords.length === 0
        ? newJobs
        : newJobs.filter((j) =>
            keywords.some((kw) => j.title.toLowerCase().includes(kw))
          );

      if (filtered.length === 0) {
        const kwNote = keywords.length > 0 ? ` matching keywords [${kwRows.map((r) => r.keyword).join(", ")}]` : "";
        await sendMessage(`☕ Scanned ${sitesScanned} compan${sitesScanned === 1 ? "y" : "ies"}, no new postings today${kwNote} (${today}).`);
        return;
      }

      // Group by company
      const byCompany = new Map<string, NewJob[]>();
      for (const job of filtered) {
        const list = byCompany.get(job.company) ?? [];
        list.push(job);
        byCompany.set(job.company, list);
      }

      const totalJobs = filtered.length;
      const companyCount = byCompany.size;
      const header = `🚨 **${totalJobs} new job${totalJobs > 1 ? "s" : ""} across ${companyCount} compan${companyCount === 1 ? "y" : "ies"}** — ${today}\n\n`;

      const lines = [...byCompany.entries()].map(([company, jobs]) =>
        jobs.map((j) => {
          const exp = j.experience ? ` • ${j.experience}` : "";
          return `🏢 **${company}** — ${j.title}${exp}\n🔗 ${j.url}`;
        }).join("\n")
      ).join("\n\n");

      const chunks = splitMessage(header + lines, 2000);
      for (const chunk of chunks) {
        await sendMessage(chunk);
      }
    });

    state.lastRunAt = today;
  },
});

function splitMessage(text: string, maxLen: number): string[] {
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
