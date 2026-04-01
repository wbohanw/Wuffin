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

export const PostPersonalInsightWorkflow = new Workflow({
  name: "postPersonalInsight",
  description: "Filter today's jobs by a subscriber's keywords and post the digest to their DM channel",
  timeout: "10m",

  input: z.object({
    dmChannelId: z.string().describe("Discord DM channel ID to post to"),
    keywords: z.string().describe("Comma-separated keyword filters (empty = all jobs)"),
  }),
  state: z.object({}),

  async handler({ input, step }) {
    await step("send", async () => {
      const { rows: allJobs } = await FilteredJobsTable.findRows({ limit: 500 });

      const userKws = input.keywords
        ? input.keywords.split(",").map((k) => k.trim()).filter(Boolean)
        : [];

      const jobs = userKws.length === 0
        ? allJobs
        : allJobs.filter((j) => userKws.some((kw) => j.title.toLowerCase().includes(kw)));

      const chunks = buildChunksFromJobs(jobs);
      for (const chunk of chunks) {
        await sendToDiscord(input.dmChannelId, chunk);
      }
    });
  },
});
