import { Workflow, z } from "@botpress/runtime";
import { seedSite } from "../utils/scanSites";
import { sendDiscordMessage } from "../utils/discordApi";

export const SeedSiteWorkflow = new Workflow({
  name: "seedSite",
  description: "Seed a company career page in the background and report the count to Discord",
  timeout: "10m",

  input: z.object({
    company: z.string(),
    url: z.string(),
    channelId: z.string(),
  }),

  state: z.object({}),

  async handler({ input, step }) {
    const { company, url, channelId } = input;

    const { seeded, links } = await step("seed", async () => {
      return await seedSite(company, url);
    });

    await step("report", async () => {
      if (links.length === 0) {
        await sendDiscordMessage(channelId, `⚠️ **${company}** — no links extracted from that page. Check the URL or try a different career page.`);
      } else {
        await sendDiscordMessage(channelId, `✅ **${company}** is live — seeded **${seeded}** new link(s) out of **${links.length}** found. You'll be notified of new ones daily.`);
      }
    });
  },
});
