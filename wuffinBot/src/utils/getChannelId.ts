import { ChannelsTable } from "../tables/ChannelsTable";

export async function getChannelId(type: string): Promise<string | undefined> {
  const { rows } = await ChannelsTable.findRows({ limit: 100 });
  return rows.find((r) => r.channelType === type)?.channelId;
}
