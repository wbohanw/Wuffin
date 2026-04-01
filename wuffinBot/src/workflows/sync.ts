import { Workflow, z, actions } from "@botpress/runtime";
import { scanSites } from "../utils/scanSites";
import { runEnrichLinks } from "../utils/runEnrichLinks";
import { runFiltering } from "../utils/runFiltering";
import { getChannelId } from "../utils/getChannelId";

const postToDiscord = async (channelId: string, text: string) => {
  await actions.discord.callApi({
    path: `/channels/${channelId}/messages`,
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
};

export const SyncWorkflow = new Workflow({
  name: "sync",
  description: "Run scan → enrich → filter in sequence and report result to Discord",
  timeout: "2h",

  input: z.object({
    channelId: z.string().optional().describe("Discord channel ID to post the result to"),
  }),
  state: z.object({}),

  async handler({ input, step }) {
    const channelId = input.channelId ?? await getChannelId("add-link") ?? "";

    try {
      await step("scan", async () => {
        await scanSites();
      });

      await step("enrich", async () => {
        await runEnrichLinks();
      });

      await step("filter", async () => {
        await runFiltering();
      });

      await step("done", async () => {
        await postToDiscord(channelId, "✅ Sync complete — scan, enrich, and filter all done.");
      });
    } catch (err) {
      await postToDiscord(channelId, `❌ Sync failed: ${String(err)}`);
      throw err;
    }
  },
});
