import { Conversation, Autonomous, z, actions } from "@botpress/runtime";
import { WatchedSitesTable } from "../tables/WatchedSitesTable";
import { LinksTable } from "../tables/LinksTable";
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
  description: "Get summary stats: total jobs, watched companies, today's new job count.",
  input: z.object({}),
  handler: async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const [{ rows: links }, { rows: sites }, { rows: todayFiltered }] = await Promise.all([
      LinksTable.findRows({ limit: 1000 }),
      WatchedSitesTable.findRows({ limit: 100 }),
      FilteredJobsTable.findRows({ limit: 500 }),
    ]);
    return {
      totalJobs: links.filter((r) => r.title).length,
      watchedCompanies: sites.length,
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

const VALID_EXP_LEVELS = new Set(["intern", "entry", "senior", "staff"]);

const DM_HELP = [
  "**Wuffin DM Commands**",
  "`/register` — subscribe to daily personal job digest",
  "`/filter` — view your current filters + copy-paste command",
  "`/filter [kw1,kw2] [city,country] exp1,exp2` — set all filters at once",
  "",
  "**Format:**",
  "`[...]` = title keywords (partial match on job title)",
  "`[...]` = locations (city / province / country, partial match)",
  "last part = experience levels: `intern` `entry` `senior` `staff`",
  "",
  "**Examples:**",
  "`/filter [software,engineer] [Toronto,Canada] intern,entry`",
  "`/filter [] [Remote] senior,staff` — remote senior/staff only, any title",
  "`/filter [] [] ` — clear all filters (receive everything)",
  "",
  "`/help` — show this message",
  "",
  "All filters are AND'd. Empty bracket or omitted = match all.",
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
        await send("✅ You're already registered! Use `/filter` to view or update your filters.");
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

    const parseList = (s: string) => s ? s.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean) : [];

    const buildFilterCommand = () => {
      const kws = subscriber.keywords || "";
      const locs = subscriber.locations || "";
      const exp = subscriber.experienceLevels || "";
      return `/filter [${kws}] [${locs}] [${exp}]`;
    };

    // --- /filter ---
    if (text === "/filter" || text.startsWith("/filter ")) {
      // No args — show current filters
      if (text === "/filter") {
        const kws = parseList(subscriber.keywords);
        const locs = parseList(subscriber.locations);
        const exps = parseList(subscriber.experienceLevels);
        const lines = [
          "**Your current filters:**",
          `• Keywords: ${kws.length ? kws.join(", ") : "(none — all titles)"}`,
          `• Locations: ${locs.length ? locs.join(", ") : "(none — all locations)"}`,
          `• Experience: ${exps.length ? exps.join(", ") : "(none — all levels)"}`,
          "",
          "**Copy and modify:**",
          `\`${buildFilterCommand()}\``,
        ];
        await send(lines.join("\n"));
        return;
      }

      // Parse: /filter [kw1,kw2] [loc1,loc2] exp1,exp2
      const match = text.match(/^\/filter\s+\[([^\]]*)\]\s+\[([^\]]*)\]\s+\[([^\]]*)\]$/) ?? text.match(/^\/filter\s+\[([^\]]*)\]\s+\[([^\]]*)\]\s*(.*)$/);
      if (!match) {
        await send("⚠️ Format: `/filter [kw1,kw2] [city,country] intern,entry`\nType `/filter` to see your current filters.");
        return;
      }

      const keywords = parseList(match[1]!).join(",");
      const locations = parseList(match[2]!).join(",");
      const expRaw = parseList(match[3]!);
      const invalidExp = expRaw.filter((e) => !VALID_EXP_LEVELS.has(e));
      if (invalidExp.length > 0) {
        await send(`⚠️ Invalid experience level(s): ${invalidExp.join(", ")}\nValid values: intern, entry, senior, staff`);
        return;
      }
      const experienceLevels = expRaw.join(",");

      await SubscribersTable.upsertRows({
        rows: [{ ...subscriber, keywords, locations, experienceLevels }],
        keyColumn: "dmChannelId",
      });

      const kws = parseList(keywords);
      const locs = parseList(locations);
      const exps = parseList(experienceLevels);
      const lines = [
        "✅ **Filters updated:**",
        `• Keywords: ${kws.length ? kws.join(", ") : "(none — all titles)"}`,
        `• Locations: ${locs.length ? locs.join(", ") : "(none — all locations)"}`,
        `• Experience: ${exps.length ? exps.join(", ") : "(none — all levels)"}`,
      ];
      await send(lines.join("\n"));
      return;
    }

    await send(DM_HELP);
  },
});
