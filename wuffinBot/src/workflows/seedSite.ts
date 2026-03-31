import { Workflow, z, bot } from "@botpress/runtime";
import { seedSite } from "../utils/scanSites";

export const SeedSiteWorkflow = new Workflow({
  name: "seedSite",
  description: "Seed a company career page in the background and report the count to Discord",
  timeout: "10m",

  input: z.object({
    company: z.string(),
    url: z.string(),
  }),

  state: z.object({}),

  async handler({ input, step, client }) {
    const { company, url } = input;

    const conversationId = bot.state.discordAddLinkConversationId;
    const userId = bot.state.discordAddLinkUserId;

    if (!conversationId || !userId) {
      console.log("[seedSite] No add-link conversation saved yet.");
      return;
    }

    const send = async (text: string) => {
      await client.createMessage({ conversationId, userId, type: "text", payload: { text }, tags: {} });
    };

    const { seeded, links } = await step("seed", async () => {
      return await seedSite(company, url);
    });

    await step("report", async () => {
      if (links.length === 0) {
        await send(`⚠️ **${company}** — no links extracted from that page. Check the URL or try a different career page.`);
      } else {
        await send(`✅ **${company}** is live — seeded **${seeded}** new link(s) out of **${links.length}** found. You'll be notified of new ones daily.`);
      }
    });
  },
});
