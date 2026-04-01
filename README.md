# Wuffin

A Discord bot that monitors company career pages for new job postings and delivers daily digests to your server. Built with Botpress ADK.

## What It Does

Wuffin watches career pages you care about, scrapes them daily, uses AI to validate and extract job details (title, summary, experience level), and sends a formatted digest to a Discord channel every morning. You can also search stored jobs using natural language right in Discord.

### Features

- **Career Page Monitoring** — Add any company's careers page and Wuffin will track it for new postings
- **Daily Digest** — Automated scan at 9 AM with results posted to Discord `#general`
- **Keyword Filtering** — Only get notified about jobs matching your keywords
- **Natural Language Search** — Ask questions like "Any new backend roles?" in `#general` and get results from the database
- **Discord Commands** — Manage everything from a `#add-link` channel

### Discord Commands

| Command | Description |
|---------|-------------|
| `/add <company> <url>` | Add a career page to the watchlist |
| `/remove <company>` | Stop monitoring a company |
| `/list` | Show all monitored sites |
| `/sync` | Manually trigger a full scan |
| `/addkw <keyword>` | Add a keyword filter |
| `/rmkw <keyword>` | Remove a keyword filter |
| `/keywords` | List active keyword filters |
| `/help` | Show available commands |

### How It Works

1. You add a career page via `/add` in the `#add-link` Discord channel
2. Wuffin seeds the site by fetching the page and storing all job links
3. Every day at 9 AM, a scheduled workflow scans all watched sites
4. New links are parsed by AI (GPT-4o-mini) to extract job title, summary, and experience level
5. Results are filtered by your keyword preferences and posted as a digest to `#general`
6. You can ask natural language questions about jobs anytime in `#general`

## Project Structure

```
wuffinBot/
├── agent.config.ts              # Bot config (integrations, models, state)
├── package.json
└── src/
    ├── actions/                  # Reusable bot functions
    │   ├── addWatchedSite.ts     # Add site to watchlist
    │   └── postToConversation.ts # Send messages to Discord channels
    ├── conversations/            # Message handlers
    │   ├── discord.ts            # Main Discord command & search handler
    │   └── index.ts              # Fallback handler for other channels
    ├── tables/                   # Database schemas
    │   ├── WatchedSitesTable.ts  # Monitored career page URLs
    │   ├── LinksTable.ts         # All discovered job postings
    │   ├── KeywordsTable.ts      # Keyword filters
    │   └── DailyNewJobsTable.ts  # Today's new jobs (cleared each scan)
    ├── utils/                    # Shared logic
    │   ├── scanSites.ts          # Core scanning & AI parsing
    │   └── extractJobLinks.ts    # Regex link extraction from HTML
    └── workflows/                # Scheduled & background tasks
        ├── jobScanner.ts         # Daily 9 AM scan workflow
        └── seedSite.ts           # Initial site seeding on /add
```

## Channel Registration

Channels must be registered before the bot responds to commands in them. The **general channel** is the only exception — it's hardcoded and always active as a conversational AI chatbot.

### Registering a channel

In the channel you want to register, send:

```
@wuffin /regist-channel:<type>
```

The bot verifies it was actually mentioned (not another user or role) by comparing the mention ID against its own Discord user ID. If they match, the channel is registered.

**Examples:**
```
@wuffin /regist-channel:add-link
@wuffin /regist-channel:insight
```

### Channel types

| Type | Purpose |
|------|---------|
| `add-link` | Manage watched career pages. Supports `/add`, `/remove`, `/list`, `/sync`, `/addkw`, `/rmkw`, `/keywords`, `/help`. |
| `insight` | Receives the daily job digest and supports `/insight` to post it on demand. |

### Rules

- A channel can only be registered once. Attempting to re-register replies with: `⛔ This channel is already registered as <type>. Please contact admin to change it.`
- Unregistered channels are completely ignored.
- The general channel is never registered via this system.

### Debug

To confirm the bot is online and check its Discord user ID:

```
@wuffin /debug
```

The bot replies with `meRes parsed bot id = <id>`.

---

## Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Bun](https://bun.sh/) (recommended) or npm/yarn/pnpm
- [Botpress ADK CLI](https://botpress.com/docs/adk) — install with `npm install -g @botpress/adk`
- A [Botpress Cloud](https://botpress.com/) account
- A Discord bot token

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/Wuffin.git
   cd Wuffin/wuffinBot
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Log in to Botpress**

   ```bash
   adk login
   ```

4. **Link to your Botpress workspace**

   If this is a fresh setup, link the bot to your workspace and bot:

   ```bash
   adk link
   ```

   Follow the prompts to select your workspace and bot.

5. **Configure Discord**

   Update the Discord bot token in `agent.config.ts` under the `discord` integration config. You'll also need to update the channel IDs in `src/conversations/discord.ts` to match your server's channels.

6. **Start the development server**

   ```bash
   adk dev
   ```

   This starts the bot in dev mode, syncing changes automatically with Botpress Cloud.

### Deploying

To deploy the bot to production:

```bash
adk deploy
```

This pushes the bot to Botpress Cloud where it runs 24/7 with the scheduled daily scan.
