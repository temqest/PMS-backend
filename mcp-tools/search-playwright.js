#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const server = new Server({
  name: "web-search-playwright",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

function stripHtml(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDuckUrl(href) {
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const targetUrl = parsed.searchParams.get("uddg");
    return targetUrl ? decodeURIComponent(targetUrl) : href;
  } catch {
    return href;
  }
}

function extractSnippet(html, startIndex) {
  const region = html.slice(startIndex, startIndex + 2500);
  const match = region.match(/class="result-snippet"[^>]*>([\s\S]*?)<\/(?:div|td)>/i)
    || region.match(/result-snippet">([\s\S]*?)<\/(?:div|td)>/i);

  return match ? stripHtml(match[1]) : "";
}

async function performWebSearch(query, maxResults = 10) {
  try {
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo Lite returned HTTP ${response.status}`);
    }

    const html = await response.text();

    if (/captcha|challenge|select all squares containing a duck/i.test(html)) {
      throw new Error("DuckDuckGo returned a bot challenge instead of search results");
    }

    const results = [];
    const seenUrls = new Set();
    const linkRegex = /<a[^>]+href="([^"]*uddg=[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = linkRegex.exec(html)) && results.length < maxResults) {
      const title = stripHtml(match[2]);

      if (!title) {
        continue;
      }

      const url = decodeDuckUrl(match[1].replace(/&amp;/g, "&"));

      if (!url || seenUrls.has(url)) {
        continue;
      }

      seenUrls.add(url);
      results.push({
        title,
        snippet: extractSnippet(html, match.index + match[0].length),
        url,
      });
    }

    return results;
  } catch (error) {
    throw new Error(`Web search failed: ${error.message}`);
  }
}

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "web_search",
        description: "Search the web using Playwright and DuckDuckGo. Returns title, snippet, and URL for each result.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to execute",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (default: 10)",
            },
            confirmed: {
              type: "boolean",
              description: "Must be true after the user explicitly approves internet access.",
            },
          },
          required: ["query", "confirmed"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "web_search") {
    const query = request.params.arguments?.query;
    const maxResults = request.params.arguments?.max_results || 10;
    const approved = request.params.arguments?.confirmed;
    
    if (!query) {
      return {
        content: [
          {
            type: "text",
            text: "Error: 'query' parameter is required",
          },
        ],
        isError: true,
      };
    }

    if (approved !== true) {
      return {
        content: [
          {
            type: "text",
            text: "Web search is blocked until the user explicitly approves internet access. Ask first, then call again with confirmed = true.",
          },
        ],
        isError: true,
      };
    }
    
    try {
      const results = await performWebSearch(query, maxResults);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error performing search: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${request.params.name}`,
      },
    ],
    isError: true,
  };
});

// Graceful shutdown
process.on("SIGINT", () => {
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(async (error) => {
  console.error("Failed to start web-search MCP server:", error);
  process.exit(1);
});
