import { Workflow, z, actions } from "@botpress/runtime";
import { scanSites } from "../utils/scanSites";
import { runFiltering } from "../utils/runFiltering";
import { buildInsightChunks } from "../utils/insightMessage";
import { getChannelId } from "../utils/getChannelId";

const sendToDiscord = async (channelId: string, text: string) => {
  await actions.discord.callApi({
    path: `/channels/${channelId}/messages`,
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
};

export const DailyJobDigestWorkflow = new Workflow({
  name: "dailyJobDigest",
  description: "Scan career pages, filter by keywords, and send the daily insight to Discord",
  schedule: "0 9 * * *",
  timeout: "2h",

  state: z.object({
    lastRunAt: z.string().optional(),
  }),

  async handler({ state, step }) {
    const today = new Date().toISOString().split("T")[0]!;

    await step("scan", async () => {
      await scanSites();
    });

    await step("filter", async () => {
      await runFiltering();
    });

    await step("send-insight", async () => {
      const channelId = await getChannelId("insight");
      if (!channelId) { console.log("[dailyJobDigest] No insight channel registered"); return; }
      const chunks = await buildInsightChunks();
      for (const chunk of chunks) {
        await sendToDiscord(channelId, chunk);
      }
    });

    state.lastRunAt = today;
  },
});
