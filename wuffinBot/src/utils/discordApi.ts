const DISCORD_API = "https://discord.com/api/v10";

export async function sendDiscordMessage(channelId: string, content: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord API error ${res.status}: ${err}`);
  }
}

export async function createDiscordThread(channelId: string, messageId: string, name: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: name.slice(0, 100) }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord thread creation error ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  return data.id as string; // thread channel ID
}
