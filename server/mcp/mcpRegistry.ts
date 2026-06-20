import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type McpDefinition = {
  name: string;
  title: string;
  enabled: boolean;
  description: string;
  stage: string;
  category?: string;
  capabilities?: string[];
  invocation?: string;
};

export type McpRegistry = {
  version: number;
  updated_at?: string;
  mcps: McpDefinition[];
};

const registryPath = path.join(process.cwd(), "server", "mcp", "mcps_registry.json");

const defaultMcps: McpRegistry = {
  version: 1,
  updated_at: "",
  mcps: [
    {
      name: "filesystem",
      title: "文件系统 MCP",
      enabled: true,
      description: "读取项目文件、写入生成代码、管理知识库文件。",
      stage: "active",
      category: "project",
      capabilities: ["read_files", "write_files", "manage_knowledge_files"],
      invocation: "/filesystem"
    },
    {
      name: "git",
      title: "Git MCP",
      enabled: true,
      description: "查看改动、生成提交说明、辅助版本管理。",
      stage: "active",
      category: "version_control",
      capabilities: ["status", "diff", "commit"],
      invocation: "/git"
    },
    {
      name: "project_analysis",
      title: "项目分析 MCP",
      enabled: true,
      description: "读取项目结构、依赖、配置和文档摘要，辅助复杂嵌入式项目规划。",
      stage: "active",
      category: "project",
      capabilities: ["project_structure", "dependency_summary", "document_summary"],
      invocation: "/project_analysis"
    },
    {
      name: "serial_hardware",
      title: "串口与硬件 MCP",
      enabled: true,
      description: "列出串口、读取串口日志、执行硬件探测。",
      stage: "active",
      category: "hardware",
      capabilities: ["list_ports", "probe_serial", "monitor_serial"],
      invocation: "/serial_hardware"
    }
  ]
};

export async function listMcps() {
  const registry = await loadMcpRegistry();
  return {
    success: true,
    registry,
    mcps: registry.mcps
  };
}

export async function loadMcpRegistry(): Promise<McpRegistry> {
  try {
    const text = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(text) as Partial<McpRegistry>;
    return normalizeRegistry(parsed);
  } catch {
    await saveMcpRegistry(defaultMcps);
    return defaultMcps;
  }
}

export async function setMcpEnabled(name: string, enabled: boolean) {
  const registry = await loadMcpRegistry();
  const index = registry.mcps.findIndex((mcp) => mcp.name === name);
  if (index < 0) throw new Error(`MCP not found: ${name}`);
  registry.mcps[index] = {
    ...registry.mcps[index],
    enabled
  };
  registry.updated_at = new Date().toISOString();
  await saveMcpRegistry(registry);
  return {
    success: true,
    mcp: registry.mcps[index],
    registry
  };
}

export async function saveMcpRegistry(registry: McpRegistry) {
  const normalized = normalizeRegistry(registry);
  await writeFile(registryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeRegistry(input: Partial<McpRegistry>): McpRegistry {
  const mcps = Array.isArray(input.mcps) ? input.mcps.map(normalizeMcp).filter(Boolean) as McpDefinition[] : [];
  return {
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    updated_at: typeof input.updated_at === "string" ? input.updated_at : "",
    mcps: mcps.length ? mcps : defaultMcps.mcps
  };
}

function normalizeMcp(input: Partial<McpDefinition> | null | undefined): McpDefinition | null {
  if (!input || !input.name) return null;
  return {
    name: String(input.name),
    title: String(input.title || input.name),
    enabled: input.enabled !== false,
    description: String(input.description || ""),
    stage: String(input.stage || "active"),
    category: input.category ? String(input.category) : inferCategory(String(input.name)),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String).filter(Boolean) : [],
    invocation: input.invocation ? String(input.invocation) : `/${String(input.name)}`
  };
}

function inferCategory(name: string) {
  if (/serial|hardware|port/.test(name)) return "hardware";
  if (/git/.test(name)) return "version_control";
  if (/file|document|project/.test(name)) return "project";
  return "general";
}
