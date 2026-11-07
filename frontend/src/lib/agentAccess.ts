export function museSetupMessage(endpointUrl: string) {
  return `Build a custom connector to Gust, my task manager. Its MCP server is at ${endpointUrl} (Streamable HTTP). It needs a bearer token in the Authorization header. Ask me for the token in a secure credential prompt, not in chat.`
}
