import { Conversation, Autonomous, z, actions } from "@botpress/runtime";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { LinksTable } from "../tables/LinksTable";
import { KeywordsTable } from "../tables/KeywordsTable";
import { FilteredJobsTable } from "../tables/FilteredJobsTable";
import { ChannelsTable } from "../tables/ChannelsTable";
import { SubscribersTable } from "../tables/SubscribersTable";
import { SeedSiteWorkflow } from "../workflows/seedSite";
import { SyncWorkflow } from "../workflows/sync";
import { buildInsightChunks } from "../utils/insightMessage";

// General channel is the only hardcoded channel
const GENERAL_CHANNEL_ID = "1488249561234542754";

// --- Help text ---

const ADD_LINK_HELP = [
  "**Commands — add-link channel**",
  "`/add CompanyName URL` — watch a career page and seed current jobs",
  "`/list` — show watched sites",
  "`/remove <company>` — stop watching a site",
  "`/sync` — manually run scan → enrich → filter",
  "`/addkw <keyword>` — add a keyword filter",
  "`/rmkw <keyword>` — remove a keyword filter",
  "`/keywords` — list active keyword filters",
  "`/help` — show this message",
].join("\n");

const GENERAL_HELP = [
  "**Commands — #general**",
  "Ask me anything about jobs, e.g.:",
  "• \"What jobs does Shopify have?\"",
  "• \"Any new jobs today?\"",
  "• \"Show me senior engineer positions\"",
  "• \"What companies are you watching?\"",
  "`/help` — show this message",
].join("\n");

// --- AI tools for general channel ---

const searchJobs = new Autonomous.Tool({
  name: "searchJobs",
  description: "Search all job listings. Use for questions about specific jobs, roles, companies, locations, experience level, or job type.",
  input: z.object({
    company: z.string().optional().describe("Filter by company name (partial match)"),
    titleKeyword: z.string().optional().describe("Filter by keyword in job title"),
    location: z.string().optional().describe("Filter by location, e.g. Toronto, Remote"),
    experience: z.enum(["entry", "junior", "senior"]).optional().describe("entry = <1 yr, junior = 1-3 yrs, senior = 3+ yrs"),
    jobType: z.enum(["full-time", "part-time", "intern", "contract"]).optional(),
    addedToday: z.boolean().optional().describe("Only return jobs first seen today"),
  }),
  handler: async ({ company, titleKeyword, location, experience, jobType, addedToday }) => {
    const { rows } = await LinksTable.findRows({ limit: 500 });
    const today = new Date().toISOString().split("T")[0]!;
    const results = rows.filter((job) => {
      if (!job.title) return false;
      if (company && !job.company.toLowerCase().includes(company.toLowerCase())) return false;
      if (titleKeyword && !job.title.toLowerCase().includes(titleKeyword.toLowerCase())) return false;
      if (location && !job.location?.toLowerCase().includes(location.toLowerCase())) return false;
      if (experience && job.experience !== experience) return false;
      if (jobType && job.jobType !== jobType) return false;
      if (addedToday && job.firstSeenAt !== today) return false;
      return true;
    });
    if (results.length === 0) return { found: false };
    return {
      found: true,
      total: results.length,
      jobs: results.map((j) => ({
        company: j.company,
        title: j.title!,
        experience: j.experience ?? null,
        location: j.location ?? null,
        jobType: j.jobType ?? null,
        summary: j.summary ?? null,
        url: j.url,
        firstSeenAt: j.firstSeenAt,
      })),
    };
  },
});

const getTodayJobs = new Autonomous.Tool({
  name: "getTodayJobs",
  description: "Get today's keyword-filtered new job postings.",
  input: z.object({}),
  handler: async () => {
    const { rows } = await FilteredJobsTable.findRows({ limit: 500 });
    if (rows.length === 0) return { found: false };
    return {
      found: true,
      total: rows.length,
      jobs: rows.map((j) => ({ company: j.company, title: j.title, location: j.location ?? null, jobType: j.jobType ?? null, url: j.url })),
    };
  },
});

const getStats = new Autonomous.Tool({
  name: "getStats",
  description: "Get summary stats: total jobs, watched companies, active keywords, today's new job count.",
  input: z.object({}),
  handler: async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const [{ rows: links }, { rows: sites }, { rows: keywords }, { rows: todayFiltered }] = await Promise.all([
      LinksTable.findRows({ limit: 1000 }),
      WatchedSitesTable.findRows({ limit: 100 }),
      KeywordsTable.findRows({ limit: 200 }),
      FilteredJobsTable.findRows({ limit: 500 }),
    ]);
    return {
      totalJobs: links.filter((r) => r.title).length,
      watchedCompanies: sites.length,
      activeKeywords: keywords.map((k) => k.keyword),
      todayNewJobs: todayFiltered.length,
      date: today,
    };
  },
});

const listCompanies = new Autonomous.Tool({
  name: "listCompanies",
  description: "List all companies currently being monitored.",
  input: z.object({}),
  handler: async () => {
    const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
    if (rows.length === 0) return { found: false };
    return { found: true, companies: rows.map((r) => ({ name: r.company, url: r.url })) };
  },
});

// --- Conversation handler ---

export const DiscordConversation = new Conversation({
  channel: "discord.guildText",

  async handler({ message, conversation, execute }) {
    const discordChannelId = conversation.tags["discord:id"];
    const discordParentId = conversation.tags["discord:parentId"] ?? conversation.tags["discord:parent_id"];
    console.log(`[discord] tags:`, JSON.stringify(conversation.tags));

    const isGeneralChannel = discordChannelId === GENERAL_CHANNEL_ID || discordParentId === GENERAL_CHANNEL_ID;

    if (message?.type !== "text") return;
    const text = message.payload.text.trim();
    console.log(`[discord] message tags:`, JSON.stringify(message.tags));
    console.log(`[discord] message payload:`, JSON.stringify(message.payload));

    // --- Debug command: @bot /debug ---
    if (text.includes("/debug")) {
      const meRes = await actions.discord.callApi({ method: "GET", path: "/users/@me" });
      const botId = (meRes.body as any)?.id as string | undefined;
      await conversation.send({ type: "text", payload: { text: `meRes parsed bot id = ${botId ?? "undefined"}` } });
      return;
    }

    // --- Registration command: @bot /regist-channel:<type> ---
    const registMatch = text.match(/\/regist-channel:(\S+)/);
    if (registMatch) {
      // Verify the bot itself was mentioned (not another user/role)
      const mentionMatch = text.match(/<@[!&]?(\d+)>/);
      if (!mentionMatch) return; // no mention at all — ignore

      const meRes = await actions.discord.callApi({ method: "GET", path: "/users/@me" });
      const botId = (meRes.body as any)?.id as string | undefined;
      if (!botId || mentionMatch[1] !== botId) return; // not the bot — ignore

      const channelType = registMatch[1]!.toLowerCase();
      const channelId = discordChannelId!;
      const { rows: existing } = await ChannelsTable.findRows({ limit: 100 });
      const alreadyRegistered = existing.find((r) => r.channelId === channelId);
      if (alreadyRegistered) {
        await conversation.send({ type: "text", payload: { text: `⛔ This channel is already registered as **${alreadyRegistered.channelType}**. Please contact admin to change it.` } });
        return;
      }
      await ChannelsTable.upsertRows({
        rows: [{ channelId, channelType, registeredAt: new Date().toISOString() }],
        keyColumn: "channelId",
      });
      await conversation.send({ type: "text", payload: { text: `✅ Channel registered as **${channelType}**` } });
      return;
    }

    // --- General channel (hardcoded) ---
    if (isGeneralChannel) {
      if (text === "/help") {
        await conversation.send({ type: "text", payload: { text: GENERAL_HELP } });
        return;
      }
      await execute({
        instructions: `You are a job board assistant with access to a live database of job postings. Answer any question about jobs, companies, or the database using your tools.

Tool usage guide:
- "what jobs does X have" / "show me X roles" → searchJobs with company filter
- "any software engineer jobs" / "show me senior roles" → searchJobs with titleKeyword or experience
- "any remote jobs" / "jobs in Toronto" → searchJobs with location
- "what's new today" / "any new jobs" → getTodayJobs
- "how many jobs" / "give me a summary" / "what keywords are set" → getStats
- "what companies are you watching" → listCompanies

Rules:
- Always call a tool before answering — never answer from memory
- If a tool returns no results, say so clearly — do not invent job listings
- Be concise. For job listings show: title, company, location, and URL`,
        tools: [searchJobs, getTodayJobs, getStats, listCompanies],
      });
      return;
    }

    // --- Registered channels: look up by channel ID (or parent for threads) ---
    const { rows: regRows } = await ChannelsTable.findRows({ limit: 100 });
    const channelRow =
      regRows.find((r) => r.channelId === discordChannelId) ??
      regRows.find((r) => r.channelId === discordParentId);

    if (!channelRow) return; // unregistered — ignore

    const channelType = channelRow.channelType;
    const send = async (t: string) => conversation.send({ type: "text", payload: { text: t } });

    // --- add-link channel ---
    if (channelType === "add-link") {
      if (text === "/help") { await send(ADD_LINK_HELP); return; }

      if (text.startsWith("/add ")) {
        const parts = text.slice(5).trim().split(" ");
        const url = parts.pop() ?? "";
        const company = parts.join(" ");
        if (!url.startsWith("http") || !company) {
          await send("⚠️ Format: `/add CompanyName https://careers.company.com`");
          return;
        }
        await WatchedSitesTable.upsertRows({ rows: [{ url, company, addedAt: new Date().toISOString() }], keyColumn: "url" });
        await SeedSiteWorkflow.start({ company, url });
        await send(`⏳ **${company}** added — seeding links in the background. Results will appear shortly.`);
        return;
      }

      if (text === "/list") {
        const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
        if (rows.length === 0) {
          await send("📋 No sites watched yet. Use `/add CompanyName URL` to add one.");
        } else {
          await send(`📋 Watching ${rows.length} site(s):\n\n${rows.map((r) => `• **${r.company}** — ${r.url}`).join("\n")}`);
        }
        return;
      }

      if (text.startsWith("/remove ")) {
        const name = text.slice(8).trim().toLowerCase();
        const { rows } = await WatchedSitesTable.findRows({ limit: 100 });
        const row = rows.find((r) => r.company.toLowerCase() === name);
        if (!row) { await send(`⚠️ No site found named \`${name}\`. Use \`/list\` to see names.`); return; }
        await WatchedSitesTable.deleteRows({ url: row.url });
        await send(`🗑️ Removed **${row.company}** from watchlist.`);
        return;
      }

      if (text === "/sync") {
        await SyncWorkflow.start({ channelId: discordChannelId ?? channelRow.channelId });
        await send("⏳ Sync started — scan → enrich → filter running in background. You'll be notified when done.");
        return;
      }

      if (text.startsWith("/addkw ")) {
        const keyword = text.slice(7).trim().toLowerCase();
        if (!keyword) { await send("⚠️ Format: `/addkw software`"); return; }
        await KeywordsTable.upsertRows({ rows: [{ keyword, addedAt: new Date().toISOString() }], keyColumn: "keyword" });
        await send(`✅ Keyword **"${keyword}"** added.`);
        return;
      }

      if (text.startsWith("/rmkw ")) {
        const keyword = text.slice(6).trim().toLowerCase();
        const { rows } = await KeywordsTable.findRows({ limit: 200 });
        const row = rows.find((r) => r.keyword === keyword);
        if (!row) { await send(`⚠️ Keyword **"${keyword}"** not found. Use \`/keywords\` to see active filters.`); return; }
        await KeywordsTable.deleteRowIds([row.id]);
        await send(`🗑️ Keyword **"${keyword}"** removed.`);
        return;
      }

      if (text === "/keywords") {
        const { rows } = await KeywordsTable.findRows({ limit: 200 });
        if (rows.length === 0) {
          await send("📋 No keyword filters set — all new jobs are reported.");
        } else {
          await send(`📋 Active keyword filters (${rows.length}):\n\n${rows.map((r) => `• ${r.keyword}`).join("\n")}`);
        }
        return;
      }

      await send(ADD_LINK_HELP);
      return;
    }

    // --- insight channel ---
    if (channelType === "insight") {
      if (text === "/insight") {
        const chunks = await buildInsightChunks();
        for (const chunk of chunks) {
          await send(chunk);
        }
      }
      return;
    }

    // All other registered channel types: ignore (no handler yet)
  },
});

export const DiscordThreadConversation = new Conversation({
  channel: "discord.publicThread",

  async handler({ message, conversation }) {
    console.log(`[discord thread] tags:`, JSON.stringify(conversation.tags));
    if (message?.type === "text") {
      console.log(`[discord thread] text:`, message.payload.text);
    }
  },
});

const VALID_EXP_LEVELS = ["intern", "entry", "senior", "staff"] as const;

const DM_HELP = [
  "**Wuffin DM Commands**",
  "`/register` — subscribe to daily personal job digest",
  "",
  "**Title keywords** (partial match on job title)",
  "`/addkw <keyword>` — e.g. `/addkw software`",
  "`/rmkw <keyword>` — remove a title keyword",
  "`/keywords` — list your title keywords",
  "",
  "**Location filters** (partial match: city, province, or country)",
  "`/addloc <location>` — e.g. `/addloc Toronto`",
  "`/rmloc <location>` — remove a location filter",
  "`/locations` — list your location filters",
  "",
  "**Experience level filters** (intern / entry / senior / staff)",
  "`/addexp <level>` — e.g. `/addexp intern`",
  "`/rmexp <level>` — remove an experience filter",
  "`/myexp` — list your experience filters",
  "",
  "`/help` — show this message",
  "",
  "All filters are AND'd together. Empty filter = match all.",
].join("\n");

export const DiscordDMConversation = new Conversation({
  channel: "discord.dm",

  async handler({ message, conversation }) {
    if (message?.type !== "text") return;
    const text = message.payload.text.trim();

    const dmChannelId = conversation.tags["discord:id"];
    const discordUserId = (message.tags as Record<string, string>)["discord:authorId"] ?? "unknown";

    if (!dmChannelId) return;

    const send = async (t: string) => conversation.send({ type: "text", payload: { text: t } });

    const getSubscriber = async () => {
      const { rows } = await SubscribersTable.findRows({ limit: 500 });
      return rows.find((r) => r.dmChannelId === dmChannelId);
    };

    if (text === "/register") {
      const existing = await getSubscriber();
      if (existing) {
        await send("✅ You're already registered! Use `/addkw <keyword>` to filter your digest.");
        return;
      }
      await SubscribersTable.upsertRows({
        rows: [{ dmChannelId, discordUserId, keywords: "", locations: "", experienceLevels: "", registeredAt: new Date().toISOString() }],
        keyColumn: "dmChannelId",
      });
      await send("✅ Registered! You'll receive a personal job digest every morning at 9 AM.\n\nType `/help` to see available filter commands.");
      return;
    }

    if (text === "/help") {
      await send(DM_HELP);
      return;
    }

    // All other commands require registration
    const subscriber = await getSubscriber();
    if (!subscriber) {
      await send("👋 You're not registered yet. Type `/register` to subscribe to daily job digests.");
      return;
    }

    const parseList = (s: string) => s ? s.split(",").map((k) => k.trim()).filter(Boolean) : [];

    const upsertSubscriber = async (patch: Partial<typeof subscriber>) => {
      await SubscribersTable.upsertRows({
        rows: [{ ...subscriber, ...patch }],
        keyColumn: "dmChannelId",
      });
    };

    // --- title keywords ---
    if (text.startsWith("/addkw ")) {
      const keyword = text.slice(7).trim().toLowerCase();
      if (!keyword) { await send("⚠️ Format: `/addkw software`"); return; }
      const current = parseList(subscriber.keywords);
      if (current.includes(keyword)) { await send(`⚠️ **"${keyword}"** is already in your title filters.`); return; }
      await upsertSubscriber({ keywords: [...current, keyword].join(",") });
      await send(`✅ Title keyword **"${keyword}"** added.`);
      return;
    }

    if (text.startsWith("/rmkw ")) {
      const keyword = text.slice(6).trim().toLowerCase();
      const current = parseList(subscriber.keywords);
      if (!current.includes(keyword)) { await send(`⚠️ **"${keyword}"** not found. Use \`/keywords\` to see your filters.`); return; }
      await upsertSubscriber({ keywords: current.filter((k) => k !== keyword).join(",") });
      await send(`🗑️ Title keyword **"${keyword}"** removed.`);
      return;
    }

    if (text === "/keywords") {
      const current = parseList(subscriber.keywords);
      await send(current.length === 0
        ? "📋 No title keyword filters — matching all job titles."
        : `📋 Title keywords (${current.length}):\n\n${current.map((k) => `• ${k}`).join("\n")}`);
      return;
    }

    // --- location filters ---
    if (text.startsWith("/addloc ")) {
      const loc = text.slice(8).trim().toLowerCase();
      if (!loc) { await send("⚠️ Format: `/addloc Toronto`"); return; }
      const current = parseList(subscriber.locations);
      if (current.includes(loc)) { await send(`⚠️ **"${loc}"** is already in your location filters.`); return; }
      await upsertSubscriber({ locations: [...current, loc].join(",") });
      await send(`✅ Location **"${loc}"** added.`);
      return;
    }

    if (text.startsWith("/rmloc ")) {
      const loc = text.slice(7).trim().toLowerCase();
      const current = parseList(subscriber.locations);
      if (!current.includes(loc)) { await send(`⚠️ **"${loc}"** not found. Use \`/locations\` to see your filters.`); return; }
      await upsertSubscriber({ locations: current.filter((l) => l !== loc).join(",") });
      await send(`🗑️ Location **"${loc}"** removed.`);
      return;
    }

    if (text === "/locations") {
      const current = parseList(subscriber.locations);
      await send(current.length === 0
        ? "📋 No location filters — matching all locations."
        : `📋 Location filters (${current.length}):\n\n${current.map((l) => `• ${l}`).join("\n")}`);
      return;
    }

    // --- experience level filters ---
    if (text.startsWith("/addexp ")) {
      const level = text.slice(8).trim().toLowerCase();
      if (!VALID_EXP_LEVELS.includes(level as any)) {
        await send(`⚠️ Invalid level. Choose from: ${VALID_EXP_LEVELS.join(", ")}`);
        return;
      }
      const current = parseList(subscriber.experienceLevels);
      if (current.includes(level)) { await send(`⚠️ **"${level}"** is already in your experience filters.`); return; }
      await upsertSubscriber({ experienceLevels: [...current, level].join(",") });
      await send(`✅ Experience level **"${level}"** added.`);
      return;
    }

    if (text.startsWith("/rmexp ")) {
      const level = text.slice(7).trim().toLowerCase();
      const current = parseList(subscriber.experienceLevels);
      if (!current.includes(level)) { await send(`⚠️ **"${level}"** not found. Use \`/myexp\` to see your filters.`); return; }
      await upsertSubscriber({ experienceLevels: current.filter((l) => l !== level).join(",") });
      await send(`🗑️ Experience level **"${level}"** removed.`);
      return;
    }

    if (text === "/myexp") {
      const current = parseList(subscriber.experienceLevels);
      await send(current.length === 0
        ? "📋 No experience filters — matching all levels."
        : `📋 Experience filters (${current.length}):\n\n${current.map((l) => `• ${l}`).join("\n")}`);
      return;
    }

    await send(DM_HELP);
  },
});
