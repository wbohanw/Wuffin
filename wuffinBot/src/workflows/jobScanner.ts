import { Workflow, z, actions } from "@botpress/runtime";
import { scanSites } from "../utils/scanSites";
import { runEnrichLinks } from "../utils/runEnrichLinks";
import { runFiltering } from "../utils/runFiltering";
import { buildInsightChunks } from "../utils/insightMessage";
import { getChannelId } from "../utils/getChannelId";
import { SubscribersTable } from "../tables/SubscribersTable";
import { PostPersonalInsightWorkflow } from "./postPersonalInsight";

const sendToDiscord = async (channelId: string, text: string) => {
  await actions.discord.callApi({
    path: `/channels/${channelId}/messages`,
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
};

export const DailyJobDigestWorkflow = new Workflow({
  name: "dailyJobDigest",
  description: "Scan career pages, filter jobs, and send daily insight to Discord channels and DM subscribers",
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

    await step("enrich", async () => {
      await runEnrichLinks();
    });

    await step("filter", async () => {
      await runFiltering();
    });

    await step("send-channel-insight", async () => {
      const channelId = await getChannelId("insight");
      if (!channelId) { console.log("[dailyJobDigest] No insight channel registered"); return; }
      const chunks = await buildInsightChunks();
      for (const chunk of chunks) {
        await sendToDiscord(channelId, chunk);
      }
    });

    await step("trigger-personal-insights", async () => {
      const { rows: subscribers } = await SubscribersTable.findRows({ limit: 500 });
      if (subscribers.length === 0) return;

      await Promise.all(
        subscribers.map((s) =>
          PostPersonalInsightWorkflow.start({
            dmChannelId: s.dmChannelId,
            keywords: s.keywords ?? "",
          })
        )
      );
    });

    state.lastRunAt = today;
  },
});
