# wuffinBot — AI Coding Guide

This is a Botpress ADK bot. All code lives in `src/`. File location = behavior — put things in the wrong folder and they won't be registered.

## Framework rules (non-negotiable)

- **All imports from `@botpress/runtime`** — never from `zod`, `@botpress/sdk`, or anywhere else
- **Tables**: use `deleteRowIds(number[])` to delete by ID, `deleteRows({ column: value })` to delete by filter — do NOT pass `{ ids: [...] }` to `deleteRows`, it will throw "Column 'ids' does not exist"
- **Sending messages in workflows**: use `actions.discord.callApi({ path: "/channels/{id}/messages", method: "POST", body: JSON.stringify({ content: "..." }) })` — never `client.createMessage()`, it will 403
- **Sending messages in conversations**: use `conversation.send({ type: "text", payload: { text: "..." } })`
- Tables must be exported from `src/tables/index.ts` or they won't be registered

## Project structure

```
src/
├── conversations/
│   ├── discord.ts        # All Discord logic (commands, registration, general AI)
│   └── index.ts          # Fallback for non-Discord channels (webchat etc.)
├── tables/
│   ├── WatchedSitesTable.ts   # Companies being monitored (key: url)
│   ├── LinksTable.ts          # All discovered job links (key: jobKey = url)
│   ├── KeywordsTable.ts       # Keyword filters (key: keyword)
│   ├── FilteredJobsTable.ts   # Today's keyword-filtered jobs (key: jobKey)
│   ├── DailyNewJobsTable.ts   # New jobs from today's scan (key: jobKey)
│   ├── ChannelsTable.ts       # Registered Discord channels (key: channelId)
│   └── index.ts               # Must export all tables
├── workflows/
│   ├── jobScanner.ts    # Daily 9 AM: scan → filter → post insight
│   ├── seedSite.ts      # On /add: seed a new career page in background
│   ├── sync.ts          # On /sync: scan → enrich → filter in sequence
│   ├── enrichLinks.ts   # Standalone: enrich unenriched links
│   └── filtering.ts     # Standalone: run keyword filter
└── utils/
    ├── scanSites.ts       # Core: browses pages, calls zai to parse jobs
    ├── runEnrichLinks.ts  # Shared: enriches LinksTable rows missing parsedAt
    ├── runFiltering.ts    # Shared: keyword-filters today's jobs → FilteredJobsTable
    ├── extractJobLinks.ts # Regex: extracts job links from markdown/HTML
    ├── insightMessage.ts  # Builds the Discord digest message chunks
    └── getChannelId.ts    # Looks up a channel ID by type from ChannelsTable
```

## Data flow

```
/add <company> <url>
  → WatchedSitesTable.upsert
  → SeedSiteWorkflow: browsePages → extractJobLinks → LinksTable.create (no zai yet)
  → EnrichLinksWorkflow: parseJobPage (zai) → fill title/summary/experience/etc.

Daily 9 AM / /sync:
  → scanSites(): for each site → browsePages → extractJobLinks
      → new link: parseJobPage (zai) immediately → LinksTable + DailyNewJobsTable
      → existing link: update lastSeenAt only
  → runEnrichLinks(): catch any unenriched rows (parsedAt empty)
  → runFiltering(): today's links with title → apply keywords → FilteredJobsTable
  → buildInsightChunks() → post to insight channel
```

## Table semantics

| Table | When populated | Cleared when |
|-------|---------------|--------------|
| `WatchedSitesTable` | `/add` command | `/remove` command |
| `LinksTable` | Every scan (new links only) | Never — permanent record |
| `DailyNewJobsTable` | Each scan (new jobs only) | Start of next scan |
| `FilteredJobsTable` | After each filter run | Before each filter run |
| `ChannelsTable` | `/regist-channel` command | Never (admin only) |

**Key LinksTable fields:**
- `title` empty = zai said it's not a real job posting (stored but ignored in filters/queries)
- `parsedAt` empty = not yet enriched by zai (runEnrichLinks will pick it up)
- `firstSeenAt` = ISO date string (`YYYY-MM-DD`), used for "today's jobs" filtering

## Discord channel system

The bot ignores all messages in unregistered channels **except** the hardcoded general channel (`GENERAL_CHANNEL_ID` in `discord.ts`).

**Registration:** `@wuffin /regist-channel:<type>` in the target channel
- Bot fetches its own ID via `actions.discord.callApi({ method: "GET", path: "/users/@me" })`
- Extracts mention ID from the message with `/<@[!&]?(\d+)>/`
- If IDs don't match → silently ignore (someone else was mentioned)
- Already registered → replies with error, no change

**Channel routing in `discord.ts`:**
1. Check if general channel → AI chatbot mode
2. Look up channel in `ChannelsTable` by `discordChannelId` or `discordParentId` (for threads)
3. Route to `add-link` or `insight` handler based on `channelType`
4. If not found → return (ignore)

**Channel types:**
- `add-link`: `/add`, `/remove`, `/list`, `/sync`, `/addkw`, `/rmkw`, `/keywords`, `/help`
- `insight`: `/insight` (posts today's filtered digest on demand)

**Finding channel IDs in conversation handler:**
```typescript
const discordChannelId = conversation.tags["discord:id"];
const discordParentId = conversation.tags["discord:parentId"] ?? conversation.tags["discord:parent_id"];
```

## Discord API calls

Always use `actions.discord.callApi` — the integration handles auth via its own bot token:
```typescript
await actions.discord.callApi({
  path: `/channels/${channelId}/messages`,
  method: "POST",
  body: JSON.stringify({ content: "your message" }),
});
```

To get the bot's own user ID (e.g. for mention verification):
```typescript
const meRes = await actions.discord.callApi({ method: "GET", path: "/users/@me" });
const botId = (meRes.body as any)?.id as string | undefined;
```

## AI / Zai usage

`adk.zai.extract(markdown, ZodSchema, { instructions })` — used in `parseJobPage` to validate and extract structured job data from a page. Returns the schema shape with `isJob: boolean` as the guard.

The `execute()` function in the general channel runs the conversational AI with tools:
- `searchJobs` — filter LinksTable by company/title/location/experience/type/date
- `getTodayJobs` — read FilteredJobsTable
- `getStats` — counts across all tables
- `listCompanies` — list WatchedSitesTable

## Common mistakes to avoid

- Don't call `client.createMessage()` in workflows — use `actions.discord.callApi`
- Don't use `deleteRows({ ids: [...] })` — use `deleteRowIds([...])`
- Don't skip exporting new tables from `src/tables/index.ts`
- Don't use `bot.state` for the Discord bot ID — fetch it live from `/users/@me`
- `getChannelId(type)` returns `undefined` if no channel is registered for that type — always null-check before posting
- Discord messages have a 2000 char limit — use `buildInsightChunks()` which splits automatically

## Debug command

`@wuffin /debug` in any channel → bot replies with its parsed bot ID from `/users/@me`. Useful to verify the Discord integration is working and confirm the mention ID format.
