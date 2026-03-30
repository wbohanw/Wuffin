import { Conversation, Autonomous, bot, context, z } from "@botpress/runtime";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { JobsTable } from "../tables/JobsTable";
import { KeywordsTable } from "../tables/KeywordsTable";
import { scanSites, seedSite } from "../utils/scanSites";

const ADD_LINK_CHANNEL_ID = "1488275758391628077";
const GENERAL_CHANNEL_ID = "1488249561234542754";

const ADD_LINK_HELP = [
  "**Commands — #add-link**",
  "`/add CompanyName URL` — watch a career page and seed current jobs",
  "`/list` — show watched sites with IDs",
  "`/remove <id>` — stop watching a site",
  "`/sync` — manually scan all sites now",
  "`/addkw <keyword>` — add a keyword filter for job alerts",
  "`/rmkw <keyword>` — remove a keyword filter",
  "`/keywords` — list active keyword filters",
  "`/help` — show this message",
].join("\n");

const GENERAL_HELP = [
  "**Commands — #general**",
  "Ask me anything about jobs in the database, e.g.:",
  "• \"What jobs does Shopify have?\"",
  "• \"Any new Toronto roles today?\"",
  "• \"Show me senior engineer positions\"",
  "`/help` — show this message",
].join("\n");

const searchJobs = new Autonomous.Tool({
  name: "searchJobs",
  description: "Search the job listings database. Filter by company, title keyword, location, or whether added today.",
  input: z.object({
    company: z.string().optional().describe("Filter by company name (partial match)"),
    titleKeyword: z.string().optional().describe("Filter by keyword in job title"),
    location: z.string().optional().describe("Filter by location (e.g. Toronto, Remote)"),
    addedToday: z.boolean().optional().describe("If true, only return jobs first seen today"),
  }),
  handler: async ({ company, titleKeyword, location, addedToday }) => {
    const { rows } = await JobsTable.findRows({ limit: 500 });
    const today = new Date().toISOString().split("T")[0]!;

    const results = rows.filter((job) => {
      if (job.title.startsWith("SKIP:")) return false;
      if (company && !job.company.toLowerCase().includes(company.toLowerCase())) return false;
      if (titleKeyword && !job.title.toLowerCase().includes(titleKeyword.toLowerCase())) return false;
      if (location && !job.location?.toLowerCase().includes(location.toLowerCase())) return false;
      if (addedToday && job.firstSeenAt !== today) return false;
      return true;
    });

    if (results.length === 0) return { found: false };

    return {
      found: true,
      jobs: results.map((j) => ({
        company: j.company,
        title: j.title,
        location: j.location ?? "N/A",
        experience: j.experience ?? "N/A",
        description: j.description ?? "N/A",
        url: j.url ?? "N/A",
        firstSeenAt: j.firstSeenAt,
      })),
    };
  },
});

export const DiscordConversation = new Conversation({
  channel: "discord.guildText",

  async handler({ message, conversation, execute }) {
    const discordChannelId = conversation.tags["discord:id"];

    // Auto-save general channel conversation ID + user ID for proactive messages
    if (discordChannelId === GENERAL_CHANNEL_ID && !bot.state.discordInsightsConversationId) {
      bot.state.discordInsightsConversationId = conversation.id;
      bot.state.discordInsightsUserId = context.get("user", { optional: true })?.id;
      console.log(`[discord] saved general channel: conv=${conversation.id} user=${bot.state.discordInsightsUserId}`);
    }

    if (message?.type !== "text") return;
    const text = message.payload.text.trim();

    // --- Add Link channel ---
    if (discordChannelId === ADD_LINK_CHANNEL_ID) {

      if (text === "/help") {
        await conversation.send({ type: "text", payload: { text: ADD_LINK_HELP } });
        return;
      }

      if (text.startsWith("/add ")) {
        const parts = text.slice(5).trim().split(" ");
        const url = parts.pop() ?? "";
        const company = parts.join(" ");

        if (!url.startsWith("http") || !company) {
          await conversation.send({ type: "text", payload: { text: "⚠️ Format: `/add CompanyName https://careers.company.com`" } });
          return;
        }

        await WatchedSitesTable.upsertRows({
          rows: [{ url, company, addedAt: new Date().toISOString() }],
          keyColumn: "url",
        });

        await conversation.send({ type: "text", payload: { text: `⏳ Added **${company}** — seeding current jobs, please wait...` } });

        const seeded = await seedSite(company, url);

        await conversation.send({ type: "text", payload: { text: `✅ **${company}** is live — seeded **${seeded}** job(s). You'll be notified of new ones daily.` } });
        return;
      }

      if (text === "/list") {
        const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
        if (rows.length === 0) {
          await conversation.send({ type: "text", payload: { text: "📋 No sites watched yet. Use `/add CompanyName URL` to add one." } });
        } else {
          const list = rows.map((r) => `\`${r.id}\` **${r.company}** — ${r.url}`).join("\n");
          await conversation.send({ type: "text", payload: { text: `📋 Watching ${rows.length} site(s):\n\n${list}` } });
        }
        return;
      }

      if (text.startsWith("/remove ")) {
        const id = text.slice(8).trim();
        const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
        const row = rows.find((r) => r.id === id);
        if (!row) {
          await conversation.send({ type: "text", payload: { text: `⚠️ No site found with ID \`${id}\`. Use \`/list\` to see IDs.` } });
          return;
        }
        await WatchedSitesTable.deleteRows({ ids: [row.id] });
        await conversation.send({ type: "text", payload: { text: `🗑️ Removed **${row.company}** from watchlist.` } });
        return;
      }

      if (text === "/sync") {
        await conversation.send({ type: "text", payload: { text: "🔄 Syncing job listings... this may take a few minutes." } });
        const { newJobs, sitesScanned } = await scanSites();
        await conversation.send({ type: "text", payload: { text: `✅ Sync complete — scanned **${sitesScanned}** site(s), found **${newJobs.length}** new job(s).` } });
        return;
      }

      if (text.startsWith("/addkw ")) {
        const keyword = text.slice(7).trim().toLowerCase();
        if (!keyword) {
          await conversation.send({ type: "text", payload: { text: "⚠️ Format: `/addkw software`" } });
          return;
        }
        await KeywordsTable.upsertRows({
          rows: [{ keyword, addedAt: new Date().toISOString() }],
          keyColumn: "keyword",
        });
        await conversation.send({ type: "text", payload: { text: `✅ Keyword **"${keyword}"** added to job alert filter.` } });
        return;
      }

      if (text.startsWith("/rmkw ")) {
        const keyword = text.slice(6).trim().toLowerCase();
        const { rows } = await KeywordsTable.findRows({ limit: 200 });
        const row = rows.find((r) => r.keyword === keyword);
        if (!row) {
          await conversation.send({ type: "text", payload: { text: `⚠️ Keyword **"${keyword}"** not found. Use \`/keywords\` to see active filters.` } });
          return;
        }
        await KeywordsTable.deleteRows({ ids: [row.id] });
        await conversation.send({ type: "text", payload: { text: `🗑️ Keyword **"${keyword}"** removed.` } });
        return;
      }

      if (text === "/keywords") {
        const { rows } = await KeywordsTable.findRows({ limit: 200 });
        if (rows.length === 0) {
          await conversation.send({ type: "text", payload: { text: "📋 No keyword filters set — all new jobs are reported. Use `/addkw <keyword>` to add one." } });
        } else {
          const list = rows.map((r) => `• ${r.keyword}`).join("\n");
          await conversation.send({ type: "text", payload: { text: `📋 Active keyword filters (${rows.length}):\n\n${list}` } });
        }
        return;
      }

      await conversation.send({ type: "text", payload: { text: ADD_LINK_HELP } });
      return;
    }

    // --- General channel ---
    if (discordChannelId === GENERAL_CHANNEL_ID) {
      if (text === "/help") {
        await conversation.send({ type: "text", payload: { text: GENERAL_HELP } });
        return;
      }

      await execute({
        instructions: `You are a job search assistant. Answer questions strictly using the searchJobs tool.

Rules:
- ALWAYS use the searchJobs tool before answering any job-related question
- If searchJobs returns found=false or an empty list, respond with "I don't know" or "No results found in the database" — do NOT make up jobs or information
- Never answer from your own knowledge about job postings — only from the database
- Be concise. List job title, company, experience, and apply link when available.`,
        tools: [searchJobs],
      });
      return;
    }
  },
});
