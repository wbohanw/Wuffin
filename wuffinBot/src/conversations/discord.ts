import { Conversation, Autonomous, bot, context, z, actions } from "@botpress/runtime";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { LinksTable } from "../tables/LinksTable";
import { KeywordsTable } from "../tables/KeywordsTable";
import { scanSites } from "../utils/scanSites";
import { SeedSiteWorkflow } from "../workflows/seedSite";

const ADD_LINK_CHANNEL_ID = "1488275758391628077";
const GENERAL_CHANNEL_ID = "1488249561234542754";

const ADD_LINK_HELP = [
  "**Commands — #add-link**",
  "`/add CompanyName URL` — watch a career page and seed current jobs",
  "`/list` — show watched sites with IDs",
  "`/remove <company>` — stop watching a site",
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
    location: z.string().optional().describe("Filter by location keyword in summary (e.g. Toronto, Remote)"),
    addedToday: z.boolean().optional().describe("If true, only return jobs first seen today"),
  }),
  handler: async ({ company, titleKeyword, location, addedToday }) => {
    const { rows } = await LinksTable.findRows({ limit: 500 });
    const today = new Date().toISOString().split("T")[0]!;

    const results = rows.filter((job) => {
      if (!job.title) return false; // invalid/non-job link
      if (company && !job.company.toLowerCase().includes(company.toLowerCase())) return false;
      if (titleKeyword && !job.title.toLowerCase().includes(titleKeyword.toLowerCase())) return false;
      if (location && !job.summary?.toLowerCase().includes(location.toLowerCase())) return false;
      if (addedToday && job.firstSeenAt !== today) return false;
      return true;
    });

    if (results.length === 0) return { found: false };

    return {
      found: true,
      jobs: results.map((j) => ({
        company: j.company,
        title: j.title!,
        experience: j.experience ?? "N/A",
        summary: j.summary ?? "N/A",
        url: j.url,
        firstSeenAt: j.firstSeenAt,
      })),
    };
  },
});

export const DiscordConversation = new Conversation({
  channel: "discord.guildText",

  async handler({ message, conversation, execute }) {
    const discordChannelId = conversation.tags["discord:id"];
    const discordParentId = conversation.tags["discord:parentId"] ?? conversation.tags["discord:parent_id"];
    console.log(`[discord] conversation tags:`, JSON.stringify(conversation.tags));

    const isAddLinkChannel = discordChannelId === ADD_LINK_CHANNEL_ID || discordParentId === ADD_LINK_CHANNEL_ID;
    const isGeneralChannel = discordChannelId === GENERAL_CHANNEL_ID || discordParentId === GENERAL_CHANNEL_ID;

    // Auto-save conversation IDs for proactive messaging
    if (isGeneralChannel && !bot.state.discordInsightsConversationId) {
      bot.state.discordInsightsConversationId = conversation.id;
      bot.state.discordInsightsUserId = context.get("user", { optional: true })?.id;
      bot.state.discordInsightsChannelId = GENERAL_CHANNEL_ID;
      console.log(`[discord] saved general channel conv=${conversation.id}`);
    }
    if (isAddLinkChannel && !bot.state.discordAddLinkConversationId) {
      bot.state.discordAddLinkConversationId = conversation.id;
      bot.state.discordAddLinkUserId = context.get("user", { optional: true })?.id;
      console.log(`[discord] saved add-link channel conv=${conversation.id}`);
    }

    if (message?.type !== "text") return;
    const text = message.payload.text.trim();
    console.log(`[discord] message tags:`, JSON.stringify(message.tags));

    // --- Add Link channel ---
    if (isAddLinkChannel) {
      const send = async (t: string) => conversation.send({ type: "text", payload: { text: t } });

      if (text === "/help") {
        await send(ADD_LINK_HELP);
        return;
      }

      if (text.startsWith("/add ")) {
        const parts = text.slice(5).trim().split(" ");
        const url = parts.pop() ?? "";
        const company = parts.join(" ");

        if (!url.startsWith("http") || !company) {
          await send("⚠️ Format: `/add CompanyName https://careers.company.com`");
          return;
        }

        await WatchedSitesTable.upsertRows({
          rows: [{ url, company, addedAt: new Date().toISOString() }],
          keyColumn: "url",
        });

        await SeedSiteWorkflow.start({ company, url });

        await send(`⏳ **${company}** added — seeding links in the background. Results will appear shortly.`);
        return;
      }

      if (text === "/list") {
        const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
        if (rows.length === 0) {
          await send("📋 No sites watched yet. Use `/add CompanyName URL` to add one.");
        } else {
          const list = rows.map((r) => `• **${r.company}** — ${r.url}`).join("\n");
          await send(`📋 Watching ${rows.length} site(s):\n\n${list}`);
        }
        return;
      }

      if (text.startsWith("/remove ")) {
        const name = text.slice(8).trim().toLowerCase();
        const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
        const row = rows.find((r) => r.company.toLowerCase() === name);
        if (!row) {
          await send(`⚠️ No site found named \`${name}\`. Use \`/list\` to see names.`);
          return;
        }
        await WatchedSitesTable.deleteRows({ url: row.url });
        await send(`🗑️ Removed **${row.company}** from watchlist.`);
        return;
      }

      if (text === "/sync") {
        await send("🔄 Syncing job listings... this may take a few minutes.");
        const { newJobs, sitesScanned } = await scanSites();
        await send(`✅ Sync complete — scanned **${sitesScanned}** site(s), found **${newJobs.length}** new job(s).`);
        return;
      }

      if (text.startsWith("/addkw ")) {
        const keyword = text.slice(7).trim().toLowerCase();
        if (!keyword) {
          await send("⚠️ Format: `/addkw software`");
          return;
        }
        await KeywordsTable.upsertRows({
          rows: [{ keyword, addedAt: new Date().toISOString() }],
          keyColumn: "keyword",
        });
        await send(`✅ Keyword **"${keyword}"** added to job alert filter.`);
        return;
      }

      if (text.startsWith("/rmkw ")) {
        const keyword = text.slice(6).trim().toLowerCase();
        const { rows } = await KeywordsTable.findRows({ limit: 200 });
        const row = rows.find((r) => r.keyword === keyword);
        if (!row) {
          await send(`⚠️ Keyword **"${keyword}"** not found. Use \`/keywords\` to see active filters.`);
          return;
        }
        await KeywordsTable.deleteRows({ ids: [row.id] });
        await send(`🗑️ Keyword **"${keyword}"** removed.`);
        return;
      }

      if (text === "/keywords") {
        const { rows } = await KeywordsTable.findRows({ limit: 200 });
        if (rows.length === 0) {
          await send("📋 No keyword filters set — all new jobs are reported. Use `/addkw <keyword>` to add one.");
        } else {
          const list = rows.map((r) => `• ${r.keyword}`).join("\n");
          await send(`📋 Active keyword filters (${rows.length}):\n\n${list}`);
        }
        return;
      }

      await send(ADD_LINK_HELP);
      return;
    }

    // --- General channel (or thread within it) ---
    if (isGeneralChannel) {
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

export const DiscordThreadConversation = new Conversation({
  channel: "discord.publicThread",

  async handler({ message, conversation }) {
    console.log(`[discord thread] conversation tags:`, JSON.stringify(conversation.tags));
    console.log(`[discord thread] conversation id:`, conversation.id);
    if (message?.type === "text") {
      console.log(`[discord thread] message tags:`, JSON.stringify(message.tags));
      console.log(`[discord thread] message text:`, message.payload.text);
    }
    // Thread messages are replies from users inside a thread the bot created.
    // The bot posts to threads proactively via workflows — no command handling needed here.
  },
});

function splitIntoChunks(text: string, maxLen: number): string[] {
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
