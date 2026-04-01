import { Workflow, z, actions } from "@botpress/runtime";
import { seedSite } from "../utils/scanSites";

const ADD_LINK_CHANNEL_ID = "1488275758391628077";

const send = async (channelId: string, text: string) => {
  await actions.discord.callApi({
    path: `/channels/${channelId}/messages`,
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
};

export const SeedSiteWorkflow = new Workflow({
  name: "seedSite",
  description: "Seed a company career page in the background and report the count to Discord",
  timeout: "10m",

  input: z.object({
    company: z.string(),
    url: z.string(),
  }),

  state: z.object({}),

  async handler({ input, step }) {
    const { company, url } = input;

    const { seeded, links } = await step("seed", async () => {
      return await seedSite(company, url);
    });

    await step("report", async () => {
      if (links.length === 0) {
        await send(ADD_LINK_CHANNEL_ID, `⚠️ **${company}** — no links extracted from that page. Check the URL or try a different career page.`);
      } else {
        await send(ADD_LINK_CHANNEL_ID, `✅ **${company}** is live — seeded **${seeded}** new link(s) out of **${links.length}** found. You'll be notified of new ones daily.`);
      }
    });
  },
});
