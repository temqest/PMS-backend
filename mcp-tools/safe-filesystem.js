#!/usr/bin/env node

const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const { Server } = require("@modelcontextprotocol/sdk/server");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const ROOTS_FILE = path.join(__dirname, "allowed-roots.json");

function loadAllowedRoots() {
  const fallbackRoot = path.resolve(__dirname, "..");

  try {
    const parsed = JSON.parse(fssync.readFileSync(ROOTS_FILE, "utf8"));
    const roots = Array.isArray(parsed) ? parsed : parsed.allowedRoots;

    if (Array.isArray(roots) && roots.length > 0) {
      return roots.map((root) => path.resolve(root));
    }
  } catch {
    // Fall back to the current workspace if the allowlist file is missing or invalid.
  }

  return [fallbackRoot];
}

let allowedRoots = loadAllowedRoots();

function refreshAllowedRoots() {
  allowedRoots = loadAllowedRoots();
}

function isWithinAllowedRoots(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function resolveUserPath(inputPath, { mustExist = false, allowMissingFinalSegment = false } = {}) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("Path is required.");
  }

  const primaryRoot = allowedRoots[0];
  const resolvedPath = path.resolve(path.isAbsolute(inputPath) ? inputPath : path.join(primaryRoot, inputPath));

  if (!isWithinAllowedRoots(resolvedPath)) {
    throw new Error(`Path is outside the allowed roots: ${inputPath}`);
  }

  if (mustExist && !fssync.existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${inputPath}`);
  }

  if (!allowMissingFinalSegment) {
    const parentPath = path.dirname(resolvedPath);
    if (!isWithinAllowedRoots(parentPath)) {
      throw new Error(`Parent path is outside the allowed roots: ${inputPath}`);
    }
  }

  return resolvedPath;
}

async function readTextFile(filePath, startLine = 1, endLine = Number.MAX_SAFE_INTEGER) {
  const absolutePath = resolveUserPath(filePath, { mustExist: true });
  const contents = await fs.readFile(absolutePath, "utf8");
  const lines = contents.split(/\r?\n/);
  const startIndex = Math.max(0, Number(startLine) - 1);
  const endIndex = Math.min(lines.length, Number(endLine));
  return lines.slice(startIndex, endIndex).join("\n");
}

async function listDirectory(dirPath) {
  const absolutePath = resolveUserPath(dirPath, { mustExist: true });
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
  }));
}

async function writeFile(filePath, content, overwrite = true) {
  const absolutePath = resolveUserPath(filePath, { allowMissingFinalSegment: true });
  const parentPath = path.dirname(absolutePath);
  await fs.mkdir(parentPath, { recursive: true });

  if (!overwrite && fssync.existsSync(absolutePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }

  await fs.writeFile(absolutePath, String(content ?? ""), "utf8");
  return absolutePath;
}

async function deleteFile(filePath) {
  const absolutePath = resolveUserPath(filePath, { mustExist: true });
  const stats = await fs.stat(absolutePath);

  if (stats.isDirectory()) {
    throw new Error("Directory deletion is blocked by this safe filesystem server.");
  }

  await fs.unlink(absolutePath);
}

async function searchFiles(query, maxResults = 20) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new Error("query is required");
  }

  const matches = [];
  const loweredQuery = normalizedQuery.toLowerCase();

  async function walkDirectory(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      const absoluteEntry = path.join(directoryPath, entry.name);

      if (!isWithinAllowedRoots(absoluteEntry)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walkDirectory(absoluteEntry);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (matches.length >= maxResults) {
        return;
      }

      try {
        const text = await fs.readFile(absoluteEntry, "utf8");
        if (text.toLowerCase().includes(loweredQuery)) {
          matches.push({ path: absoluteEntry, type: "text-match" });
        }
      } catch {
        // Ignore binary or unreadable files.
      }
    }
  }

  for (const root of allowedRoots) {
    await walkDirectory(root);
    if (matches.length >= maxResults) {
      break;
    }
  }

  return matches.slice(0, maxResults);
}

const server = new Server(
  {
    name: "safe-filesystem",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_directory",
      description: "List files and folders within the allowed workspace roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    {
      name: "read_file",
      description: "Read a text file within the allowed workspace roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          start_line: { type: "number" },
          end_line: { type: "number" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a file within the allowed workspace roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          overwrite: { type: "boolean" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "delete_file",
      description: "Delete a file within the allowed workspace roots. Requires explicit confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          confirm: {
            type: "string",
            description: "Type DELETE to confirm the file deletion.",
          },
        },
        required: ["path", "confirm"],
      },
    },
    {
      name: "search_files",
      description: "Search text inside files within the allowed workspace roots.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "refresh_allowed_roots",
      description: "Reload the allowed workspace roots from allowed-roots.json.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments ?? {};

  try {
    switch (toolName) {
      case "list_directory": {
        const entries = await listDirectory(args.path);
        return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
      }

      case "read_file": {
        const text = await readTextFile(args.path, args.start_line, args.end_line);
        return { content: [{ type: "text", text }] };
      }

      case "write_file": {
        const outputPath = await writeFile(args.path, args.content, args.overwrite !== false);
        return { content: [{ type: "text", text: `Wrote file: ${outputPath}` }] };
      }

      case "delete_file": {
        if (String(args.confirm ?? "").trim().toUpperCase() !== "DELETE") {
          return {
            content: [
              {
                type: "text",
                text: "Delete blocked. Ask for confirmation first, then call again with confirm = DELETE.",
              },
            ],
            isError: true,
          };
        }

        await deleteFile(args.path);
        return { content: [{ type: "text", text: `Deleted file: ${args.path}` }] };
      }

      case "search_files": {
        const results = await searchFiles(args.query, args.max_results ?? 20);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "refresh_allowed_roots": {
        refreshAllowedRoots();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(allowedRoots, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start safe filesystem MCP server:", error);
  process.exit(1);
});