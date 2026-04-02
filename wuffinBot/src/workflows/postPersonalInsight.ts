import { Workflow, z, actions } from "@botpress/runtime";
import { FilteredJobsTable } from "../tables/FilteredJobsTable";
import { buildChunksFromJobs } from "../utils/insightMessage";

const sendToDiscord = async (channelId: string, text: string) => {
  await actions.discord.callApi({
    path: `/channels/${channelId}/messages`,
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
};

const parseList = (s: string) => s ? s.split(",").map((k) => k.trim()).filter(Boolean) : [];

export const PostPersonalInsightWorkflow = new Workflow({
  name: "postPersonalInsight",
  description: "Filter today's jobs by a subscriber's keywords, locations, and experience levels, then post the digest to their DM channel",
  timeout: "10m",

  input: z.object({
    dmChannelId: z.string().describe("Discord DM channel ID to post to"),
    keywords: z.string().describe("Comma-separated title keyword filters (empty = all)"),
    locations: z.string().describe("Comma-separated location filters, partial match (empty = all)"),
    experienceLevels: z.string().describe("Comma-separated experience level filters: intern, entry, senior, staff (empty = all)"),
  }),
  state: z.object({}),

  async handler({ input, step }) {
    await step("send", async () => {
      const { rows: allJobs } = await FilteredJobsTable.findRows({ limit: 500 });

      const titleKws = parseList(input.keywords);
      const locs = parseList(input.locations);
      const expLevels = parseList(input.experienceLevels);

      const jobs = allJobs.filter((j) => {
        if (titleKws.length > 0 && !titleKws.some((kw) => j.title.toLowerCase().includes(kw))) return false;
        if (locs.length > 0 && !locs.some((loc) => j.location?.toLowerCase().includes(loc))) return false;
        if (expLevels.length > 0 && !expLevels.includes(j.experience ?? "")) return false;
        return true;
      });

      const chunks = buildChunksFromJobs(jobs);
      for (const chunk of chunks) {
        await sendToDiscord(input.dmChannelId, chunk);
      }
    });
  },
});
