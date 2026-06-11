// Parley memory over the Model Context Protocol: three read-only tools that
// enforce the exact same query-time permission filters as the app, because
// they call the same server API a signed-in user would.
//
// Config (environment):
//   PARLEY_URL    server origin, e.g. http://localhost:4000
//   PARLEY_TOKEN  a personal access token from Parley settings
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  callMemoryApi,
  formatAnswer,
  formatSearchResults,
  MemoryApiError,
  type AnswerCitation,
  type MemoryConfig,
  type SearchResult,
} from './lib.js';

const config: MemoryConfig = {
  baseUrl: process.env['PARLEY_URL'] ?? 'http://localhost:4000',
  token: process.env['PARLEY_TOKEN'] ?? '',
};

if (!config.token) {
  process.stderr.write(
    'PARLEY_TOKEN is required. Generate a personal access token in Parley settings.\n',
  );
  process.exit(1);
}

const server = new McpServer({ name: 'parley-memory', version: '0.1.0' });

function asToolResult(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text }] };
}

function asToolError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const message =
    err instanceof MemoryApiError
      ? `${err.code}: ${err.message}`
      : 'Parley is unreachable. Check PARLEY_URL and that the server is running.';
  return { content: [{ type: 'text', text: message }], isError: true };
}

server.tool(
  'search_memory',
  'Search the team chat and document history you have access to. Returns the most relevant messages and document excerpts.',
  { query: z.string().min(2).max(600).describe('What to look for') },
  async ({ query }) => {
    try {
      const { results } = await callMemoryApi<{ results: SearchResult[] }>(
        config,
        '/memory/search',
        { query },
      );
      return asToolResult(formatSearchResults(results));
    } catch (err) {
      return asToolError(err);
    }
  },
);

server.tool(
  'ask_memory',
  'Ask the team memory a question. Returns a grounded answer with citations to the source messages, or says plainly when the history does not contain the answer.',
  { question: z.string().min(3).max(600).describe('The question to answer from team history') },
  async ({ question }) => {
    try {
      const response = await callMemoryApi<{
        answer: string;
        cached: boolean;
        citations: AnswerCitation[];
      }>(config, '/memory/ask', { question });
      return asToolResult(formatAnswer(response.answer, response.citations, response.cached));
    } catch (err) {
      return asToolError(err);
    }
  },
);

server.tool(
  'catch_me_up',
  'Get a cited digest of what happened in a room since you last read it.',
  { room: z.string().min(1).max(64).describe('Room name, e.g. launch-week or #launch-week') },
  async ({ room }) => {
    try {
      const response = await callMemoryApi<{ digest: string; citations: AnswerCitation[] }>(
        config,
        '/memory/catchup',
        { room },
      );
      return asToolResult(formatAnswer(response.digest, response.citations, false));
    } catch (err) {
      return asToolError(err);
    }
  },
);

await server.connect(new StdioServerTransport());
