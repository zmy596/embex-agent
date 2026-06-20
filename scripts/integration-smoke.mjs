import { runConversationAgent } from "../server/conversationAgent.ts";
import { reindexKnowledge, searchKnowledge } from "../server/knowledge/ragStore.ts";
import { clearMemory, getMemoryState, updateMemoryState } from "../server/memory/memoryStore.ts";
import { listMcps } from "../server/mcp/mcpRegistry.ts";
import { listSkills } from "../server/skills/skillRegistry.ts";

await clearMemory();
await reindexKnowledge();

await updateMemoryState({
  long_term_summary: "用户确认 Embex 是面向 ESP 系列嵌入式开发的智能体，需要保留 RAG、记忆、Skill、MCP 和工具调用闭环。",
  hardware_state: {
    closed_loop: {
      board_model: "luatos-esp32c3-core",
      port: "COM12"
    }
  },
  project_facts: [
    "Embex focuses on ESP-series firmware generation, compile/upload, serial monitoring, and diagnosis."
  ]
});

const [skills, mcps, search] = await Promise.all([
  listSkills(),
  listMcps(),
  searchKnowledge("ESP32-C3 GPIO18 OLED reset", 4)
]);

if (!skills.success || !skills.skills.some((skill) => skill.name === "esp_pin_analyzer" && skill.enabled)) {
  throw new Error("esp_pin_analyzer skill is not enabled for integration smoke");
}

if (!mcps.success || !mcps.mcps.some((mcp) => mcp.name === "project_analysis" && mcp.enabled)) {
  throw new Error("project_analysis MCP is not enabled for integration smoke");
}

if (!search.hits.some((hit) => /oled|luatos|gpio/i.test(hit.filename))) {
  throw new Error("Expected built-in ESP/OLED knowledge to be searchable");
}

const pinResult = await runConversationAgent({
  message: "/esp_pin_analyzer 检查 GPIO18 是否适合作为 OLED RES",
  closedLoop: { board_model: "luatos-esp32c3-core", port: "COM12" },
  hardwareStatus: { board_model: "luatos-esp32c3-core", selectedPort: "COM12" },
  llm: { enabled: false }
});

const pinSkill = pinResult.tool_calls?.find((tool) => tool.name === "skill_invocation");
const pinFinding = pinSkill?.result?.findings?.find((finding) => finding.pin === "GPIO18");
const pinRag = pinResult.tool_calls?.find((tool) => tool.name === "rag_knowledge_search");

if (!pinSkill || pinSkill.success !== true || pinFinding?.status !== "avoid") {
  throw new Error("Integrated skill invocation did not flag GPIO18 as avoid");
}

if (!pinRag || !Array.isArray(pinRag.result?.citations) || pinRag.result.citations.length === 0) {
  throw new Error("Integrated skill invocation did not include RAG citations");
}

const projectResult = await runConversationAgent({
  message: "/project_analysis",
  llm: { enabled: false }
});

const projectMcp = projectResult.tool_calls?.find((tool) => tool.name === "mcp_invocation");
if (!projectMcp || projectMcp.success !== true || projectMcp.result?.mode !== "project_analysis") {
  throw new Error("Integrated project_analysis MCP invocation failed");
}

const memoryState = await getMemoryState();
if (!memoryState.success || memoryState.recent_turns.length < 2) {
  throw new Error("Integrated conversations were not persisted to memory");
}

const recentToolNames = memoryState.recent_turns
  .flatMap((turn) => turn.project_state?.tool_calls || [])
  .filter(Boolean);

console.log(JSON.stringify({
  success: true,
  knowledge_hit: search.hits[0]?.filename,
  skill_count: skills.skills.length,
  mcp_count: mcps.mcps.length,
  pin_status: pinFinding.status,
  rag_citations: pinRag.result.citations.length,
  project_analysis_dirs: projectMcp.result.directories.length,
  memory_turns: memoryState.recent_turns.length,
  memory_tool_records: recentToolNames.length
}, null, 2));
