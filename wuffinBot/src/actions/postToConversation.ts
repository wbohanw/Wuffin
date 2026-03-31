import { Action, z } from "@botpress/runtime";

export const postToConversation = new Action({
  name: "postToConversation",
  description: "Post a text message to a specific conversation (channel or thread)",
  input: z.object({
    conversationId: z.string().describe("The conversation ID to post to"),
    userId: z.string().describe("The user ID to post as"),
    text: z.string().describe("The message text to send"),
  }),
  output: z.object({
    sent: z.boolean(),
  }),

  async handler({ input, client }) {
    console.log(`[postToConversation] conversationId=${input.conversationId} userId="${input.userId}"`);
    await client.createMessage({
      conversationId: input.conversationId,
      userId: input.userId,
      type: "text",
      payload: { text: input.text },
      tags: {},
    });
    return { sent: true };
  },
});
