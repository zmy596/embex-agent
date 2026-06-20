import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type FilesystemMcpInput = {
  query?: string;
};

export type FilesystemMcpFile = {
  path: string;
  size: number;
  extension: string;
  kind: "file" | "directory";
};

export type FilesystemMcpResult = {
  success: boolean;
  summary: string;
  mode: "project_overview" | "knowledge_summary" | "source_summary" | "memory_summary";
  roots: string[];
  files: FilesystemMcpFile[];
  counts: {
    files: number;
    directories: number;
    bytes: number;
  };
  next_step: string;
};

const WORKSPACE_ROOT = process.cwd();
const MAX_FILES_PER_ROOT = 80;
const MAX_DEPTH = 4;

const ROOT_GROUPS = {
  project_overview: [
    "server",
    "src",
    "scripts",
    "esp_agent/knowledge",
    "esp_agent/skills",
    "memory",
    "package.json",
    "README.md",
    "CHIPWIZ_RAG_MEMORY_SKILL_MCP_PLAN.md",
    "CHIPWIZ_RAG_MEMORY_SKILL_MCP_GOAL_TRACKER.md"
  ],
  knowledge_summary: [
    "esp_agent/knowledge",
    "esp_agent/skills",
    "CHIPWIZ_RAG_MEMORY_SKILL_MCP_PLAN.md",
    "CHIPWIZ_STAGE1_ARCHITECTURE_BOUNDARY.md"
  ],
  source_summary: [
    "server",
    "src",
    "scripts",
    "package.json",
    "tsconfig.json",
    "vite.config.ts"
  ],
  memory_summary: [
    "memory",
    "server/memory",
    "CHIPWIZ_RAG_MEMORY_SKILL_MCP_GOAL_TRACKER.md"
  ]
} as const;

const SKIP_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".vite",
  ".tmp",
  ".cache",
  "__pycache__"
]);

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".pdf",
  ".pptx",
  ".docx",
  ".xlsx",
  ".zip",
  ".7z",
  ".rar",
  ".bin",
  ".elf",
  ".map"
]);

export async function runFilesystemMcp(input: FilesystemMcpInput): Promise<FilesystemMcpResult> {
  const mode = inferMode(input.query || "");
  const roots = [...ROOT_GROUPS[mode]];
  const files: FilesystemMcpFile[] = [];

  for (const root of roots) {
    const absolute = safeResolve(root);
    if (!absolute) continue;
    try {
      const rootStat = await stat(absolute);
      if (rootStat.isDirectory()) {
        files.push(...await walkDirectory(absolute, root, 0));
      } else if (rootStat.isFile() && isAllowedFile(root)) {
        files.push(toFileEntry(root, rootStat.size, "file"));
      }
    } catch {
      // Missing optional roots are ignored so the MCP can work across partial checkouts.
    }
  }

  const limitedFiles = files.slice(0, MAX_FILES_PER_ROOT * roots.length);
  const counts = limitedFiles.reduce(
    (acc, item) => {
      if (item.kind === "directory") acc.directories += 1;
      else {
        acc.files += 1;
        acc.bytes += item.size;
      }
      return acc;
    },
    { files: 0, directories: 0, bytes: 0 }
  );

  return {
    success: true,
    summary: `Filesystem MCP scanned ${counts.files} files and ${counts.directories} directories in controlled ${mode} scope.`,
    mode,
    roots,
    files: limitedFiles,
    counts,
    next_step: "可在对话中使用 /filesystem knowledge 查看知识库文件摘要，或使用 /filesystem source 查看源码结构摘要。"
  };
}

function inferMode(query: string): FilesystemMcpResult["mode"] {
  const text = query.toLowerCase();
  if (/knowledge|rag|知识库|文档|资料|pinout|引脚/.test(text)) return "knowledge_summary";
  if (/memory|记忆|上下文|conversation/.test(text)) return "memory_summary";
  if (/source|server|src|script|代码|源码|工程/.test(text)) return "source_summary";
  return "project_overview";
}

async function walkDirectory(absoluteDir: string, relativeDir: string, depth: number): Promise<FilesystemMcpFile[]> {
  if (depth > MAX_DEPTH) return [];
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const results: FilesystemMcpFile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (shouldSkip(entry.name)) continue;
    const relative = normalizeRelativePath(path.join(relativeDir, entry.name));
    const absolute = safeResolve(relative);
    if (!absolute) continue;
    if (entry.isDirectory()) {
      results.push(toFileEntry(relative, 0, "directory"));
      if (results.length < MAX_FILES_PER_ROOT) {
        results.push(...await walkDirectory(absolute, relative, depth + 1));
      }
    } else if (entry.isFile() && isAllowedFile(relative)) {
      const fileStat = await stat(absolute);
      results.push(toFileEntry(relative, fileStat.size, "file"));
    }
    if (results.length >= MAX_FILES_PER_ROOT) break;
  }
  return results;
}

function safeResolve(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) return null;
  const absolute = path.resolve(WORKSPACE_ROOT, normalized);
  const relative = path.relative(WORKSPACE_ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

function shouldSkip(name: string) {
  return SKIP_NAMES.has(name) || name.startsWith(".tmp") || name.endsWith(".tsbuildinfo");
}

function isAllowedFile(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  return !SKIP_EXTENSIONS.has(extension);
}

function toFileEntry(relativePath: string, size: number, kind: FilesystemMcpFile["kind"]): FilesystemMcpFile {
  return {
    path: normalizeRelativePath(relativePath),
    size,
    extension: kind === "file" ? path.extname(relativePath).toLowerCase() || "(none)" : "(dir)",
    kind
  };
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}
