import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SkillDefinition = {
  name: string;
  title: string;
  enabled: boolean;
  description: string;
  inputs: string[];
  outputs: string[];
  stage: string;
  category?: string;
  invocation?: string;
  examples?: string[];
};

export type SkillsRegistry = {
  version: number;
  updated_at?: string;
  skills: SkillDefinition[];
};

const registryPath = path.join(process.cwd(), "esp_agent", "skills", "skills_registry.json");

const defaultSkills: SkillsRegistry = {
  version: 1,
  updated_at: "",
  skills: [
    {
      name: "platformio_project_manager",
      title: "PlatformIO 工程管理",
      enabled: true,
      description: "规划、生成和检查 ESP PlatformIO 工程结构。",
      inputs: ["board_model", "framework", "dependencies"],
      outputs: ["project_plan", "platformio_ini_notes"],
      stage: "active",
      category: "project",
      invocation: "/platformio_project_manager"
    },
    {
      name: "esp_pin_analyzer",
      title: "ESP 板卡与引脚分析",
      enabled: true,
      description: "根据板卡引脚资料分析 GPIO 是否适合外设连接。",
      inputs: ["board_model", "pins", "peripherals"],
      outputs: ["pin_risk_report"],
      stage: "active",
      category: "hardware",
      invocation: "/esp_pin_analyzer"
    },
    {
      name: "serial_log_diagnosis",
      title: "串口日志诊断",
      enabled: true,
      description: "分析编译、烧录和串口日志中的 ESP 常见故障。",
      inputs: ["log", "task_description"],
      outputs: ["diagnosis", "next_step"],
      stage: "active",
      category: "diagnosis",
      invocation: "/serial_log_diagnosis"
    },
    {
      name: "peripheral_project_composer",
      title: "外设组合小项目规划",
      enabled: true,
      description: "根据当前已连接并启用的外设、板卡型号和引脚配置，组合出可实现的小型嵌入式项目方案，并给出固件结构、交互逻辑和验收标准。",
      inputs: ["board_model", "port", "peripherals", "hardwareStatus", "project_goal"],
      outputs: ["project_idea", "firmware_flow", "peripheral_roles", "acceptance_checks", "next_prompt"],
      stage: "active",
      category: "project",
      invocation: "/peripheral_project_composer",
      examples: [
        "/peripheral_project_composer 做一个环境监测小项目",
        "/peripheral_project_composer 根据当前外设组合一个可演示项目"
      ]
    }
  ]
};

export async function listSkills() {
  const registry = await loadSkillsRegistry();
  return {
    success: true,
    registry,
    skills: registry.skills
  };
}

export async function loadSkillsRegistry(): Promise<SkillsRegistry> {
  try {
    const text = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(text) as Partial<SkillsRegistry>;
    return normalizeRegistry(parsed);
  } catch {
    await saveSkillsRegistry(defaultSkills);
    return defaultSkills;
  }
}

export async function setSkillEnabled(name: string, enabled: boolean) {
  const registry = await loadSkillsRegistry();
  const index = registry.skills.findIndex((skill) => skill.name === name);
  if (index < 0) {
    throw new Error(`Skill not found: ${name}`);
  }
  registry.skills[index] = {
    ...registry.skills[index],
    enabled
  };
  registry.updated_at = new Date().toISOString();
  await saveSkillsRegistry(registry);
  return {
    success: true,
    skill: registry.skills[index],
    registry
  };
}

export async function saveSkillsRegistry(registry: SkillsRegistry) {
  const normalized = normalizeRegistry(registry);
  await writeFile(registryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeRegistry(input: Partial<SkillsRegistry>): SkillsRegistry {
  const skills = Array.isArray(input.skills) ? input.skills.map(normalizeSkill).filter(Boolean) as SkillDefinition[] : [];
  return {
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    updated_at: typeof input.updated_at === "string" ? input.updated_at : "",
    skills: skills.length ? skills : defaultSkills.skills
  };
}

function normalizeSkill(input: Partial<SkillDefinition> | null | undefined): SkillDefinition | null {
  if (!input || !input.name) return null;
  return {
    name: String(input.name),
    title: String(input.title || input.name),
    enabled: input.enabled !== false,
    description: String(input.description || ""),
    inputs: normalizeStringList(input.inputs),
    outputs: normalizeStringList(input.outputs),
    stage: String(input.stage || "active"),
    category: input.category ? String(input.category) : inferCategory(String(input.name)),
    invocation: input.invocation ? String(input.invocation) : `/${String(input.name)}`,
    examples: normalizeStringList(input.examples)
  };
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function inferCategory(name: string) {
  if (/pin|gpio|hardware|board/.test(name)) return "hardware";
  if (/log|diagnos|error/.test(name)) return "diagnosis";
  if (/platformio|project|firmware|composer/.test(name)) return "project";
  return "general";
}
