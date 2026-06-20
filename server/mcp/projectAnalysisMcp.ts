import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ProjectAnalysisMcpInput = {
  query?: string;
};

export type ProjectAnalysisMcpResult = {
  success: boolean;
  summary: string;
  mode: "project_analysis";
  package_info: {
    name: string;
    version: string;
    scripts: string[];
    dependencies: string[];
    dev_dependencies: string[];
  };
  directories: Array<{
    path: string;
    files: number;
    directories: number;
    extensions: Record<string, number>;
  }>;
  documents: Array<{
    path: string;
    title: string;
    excerpt: string;
  }>;
  config_files: Array<{
    path: string;
    size: number;
    extension: string;
  }>;
  risks: string[];
  next_step: string;
};

const ROOT = process.cwd();
const ANALYSIS_DIRS = ["server", "src", "scripts", "esp_agent", "memory"];
const DOC_FILES = [
  "README.md",
  "CHIPWIZ_RAG_MEMORY_SKILL_MCP_PLAN.md",
  "CHIPWIZ_RAG_MEMORY_SKILL_MCP_GOAL_TRACKER.md",
  "CHIPWIZ_STAGE1_ARCHITECTURE_BOUNDARY.md",
  "CONDA_ENV.md",
  "ESP_AGENT_REFACTOR_PLAN.md"
];
const CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "environment.yml",
  ".env.example"
];
const MAX_DOC_CHARS = 900;
const SKIP_NAMES = new Set(["node_modules", "dist", ".git", ".vite", "__pycache__"]);

export async function runProjectAnalysisMcp(_input: ProjectAnalysisMcpInput = {}): Promise<ProjectAnalysisMcpResult> {
  const [packageInfo, directories, documents, configFiles] = await Promise.all([
    readPackageInfo(),
    Promise.all(ANALYSIS_DIRS.map(analyzeDirectory)),
    readDocuments(),
    readConfigFiles()
  ]);
  const existingDirectories = directories.filter((item) => item.files + item.directories > 0);
  const risks = inferRisks(packageInfo, existingDirectories, documents);
  return {
    success: true,
    summary: `项目分析 MCP 已检查 ${existingDirectories.length} 个目录、${documents.length} 份文档和 ${configFiles.length} 个配置文件。`,
    mode: "project_analysis",
    package_info: packageInfo,
    directories: existingDirectories,
    documents,
    config_files: configFiles,
    risks,
    next_step: "可以结合 /filesystem source 查看文件清单，结合 /git status 查看改动，再让 Embex 规划下一项嵌入式开发任务。"
  };
}

async function readPackageInfo(): Promise<ProjectAnalysisMcpResult["package_info"]> {
  try {
    const text = await readTextFile("package.json", 80_000);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const scripts = parsed.scripts && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts) : [];
    const dependencies = parsed.dependencies && typeof parsed.dependencies === "object" ? Object.keys(parsed.dependencies) : [];
    const devDependencies = parsed.devDependencies && typeof parsed.devDependencies === "object" ? Object.keys(parsed.devDependencies) : [];
    return {
      name: String(parsed.name || "unknown"),
      version: String(parsed.version || ""),
      scripts,
      dependencies,
      dev_dependencies: devDependencies
    };
  } catch {
    return {
      name: "unknown",
      version: "",
      scripts: [],
      dependencies: [],
      dev_dependencies: []
    };
  }
}

async function analyzeDirectory(relativeDir: string) {
  const result = {
    path: relativeDir,
    files: 0,
    directories: 0,
    extensions: {} as Record<string, number>
  };
  const absolute = safeResolve(relativeDir);
  if (!absolute) return result;
  try {
    await walk(absolute, relativeDir, result, 0);
  } catch {
    // Optional directories can be absent in partial worktrees.
  }
  return result;
}

async function walk(absoluteDir: string, relativeDir: string, result: { files: number; directories: number; extensions: Record<string, number> }, depth: number) {
  if (depth > 4) return;
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const relative = normalizePath(path.join(relativeDir, entry.name));
    const absolute = safeResolve(relative);
    if (!absolute) continue;
    if (entry.isDirectory()) {
      result.directories += 1;
      await walk(absolute, relative, result, depth + 1);
    } else if (entry.isFile()) {
      result.files += 1;
      const ext = path.extname(entry.name).toLowerCase() || "(none)";
      result.extensions[ext] = (result.extensions[ext] || 0) + 1;
    }
  }
}

async function readDocuments() {
  const docs: ProjectAnalysisMcpResult["documents"] = [];
  for (const file of DOC_FILES) {
    try {
      const text = await readTextFile(file, MAX_DOC_CHARS);
      docs.push({
        path: file,
        title: extractTitle(text) || file,
        excerpt: compactText(text)
      });
    } catch {
      // Missing docs are ignored.
    }
  }
  return docs;
}

async function readConfigFiles() {
  const configs: ProjectAnalysisMcpResult["config_files"] = [];
  for (const file of CONFIG_FILES) {
    const absolute = safeResolve(file);
    if (!absolute) continue;
    try {
      const info = await stat(absolute);
      if (!info.isFile()) continue;
      configs.push({
        path: file,
        size: info.size,
        extension: path.extname(file).toLowerCase() || "(none)"
      });
    } catch {
      // Missing config files are ignored.
    }
  }
  return configs;
}

function inferRisks(
  packageInfo: ProjectAnalysisMcpResult["package_info"],
  directories: ProjectAnalysisMcpResult["directories"],
  documents: ProjectAnalysisMcpResult["documents"]
) {
  const risks: string[] = [];
  if (!packageInfo.scripts.includes("typecheck")) risks.push("package.json 缺少 typecheck 脚本，后续功能变更缺少基础类型验证入口。");
  if (!packageInfo.scripts.includes("build")) risks.push("package.json 缺少 build 脚本，生产构建无法统一验收。");
  if (!directories.some((item) => item.path === "server")) risks.push("未检测到 server 目录，后端能力链路可能不完整。");
  if (!directories.some((item) => item.path === "src")) risks.push("未检测到 src 目录，Web UI 链路可能不完整。");
  if (!documents.some((item) => item.path.includes("GOAL_TRACKER"))) risks.push("未检测到目标追踪文档，长期任务追踪可能缺失。");
  return risks.length ? risks : ["当前项目分析未发现阻断性结构风险。"];
}

async function readTextFile(relativePath: string, maxChars: number) {
  const absolute = safeResolve(relativePath);
  if (!absolute) throw new Error(`Unsafe path: ${relativePath}`);
  const text = await readFile(absolute, "utf8");
  return text.replace(/^\uFEFF/, "").slice(0, maxChars);
}

function safeResolve(relativePath: string) {
  const normalized = normalizePath(relativePath);
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) return null;
  const absolute = path.resolve(ROOT, normalized);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

function extractTitle(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("#"))?.replace(/^#+\s*/, "") || "";
}

function compactText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .slice(0, MAX_DOC_CHARS);
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}
