import { Conversation } from "@botpress/runtime";

// Fallback handler for non-Discord channels (webchat, etc.)
export default new Conversation({
  channel: "*",
  handler: async ({ conversation, execute }) => {
    // Skip Discord channels — handled by discord.ts
    if (conversation.tags["discord:id"] || conversation.tags["discord:guildId"]) return;

    await execute({
      instructions: `You are a helpful AI assistant built with Botpress ADK. You can assist users with their questions and tasks.`,
    });
  },
});
