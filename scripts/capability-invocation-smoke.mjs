import { runConversationAgent } from "../server/conversationAgent.ts";

const skillResult = await runConversationAgent({
  message: "/esp_pin_analyzer 检查 GPIO18 是否适合 OLED RES",
  closedLoop: { board_model: "luatos-esp32c3-core" },
  llm: { enabled: false }
});

const skillCall = skillResult.tool_calls?.find((tool) => tool.name === "skill_invocation");
if (!skillCall || skillCall.success !== true) {
  throw new Error("Expected /esp_pin_analyzer to produce a successful skill_invocation tool call");
}
const skillResultPayload = skillCall.result || {};
const pinFinding = skillResultPayload.findings?.find((finding) => finding.pin === "GPIO18");
if (!pinFinding || pinFinding.status !== "avoid") {
  throw new Error("Expected esp_pin_analyzer to flag GPIO18 as avoid on luatos-esp32c3-core");
}

const mcpResult = await runConversationAgent({
  message: "/serial_hardware 列出当前串口能力",
  llm: { enabled: false }
});

const mcpCall = mcpResult.tool_calls?.find((tool) => tool.name === "mcp_invocation");
if (!mcpCall || mcpCall.success !== true) {
  throw new Error("Expected /serial_hardware to produce a successful mcp_invocation tool call");
}
if (!mcpCall.result || mcpCall.result.mode !== "list_ports" || !("ports_result" in mcpCall.result)) {
  throw new Error("Expected /serial_hardware to execute the real serial hardware MCP");
}

const filesystemResult = await runConversationAgent({
  message: "/filesystem knowledge",
  llm: { enabled: false }
});

const filesystemCall = filesystemResult.tool_calls?.find((tool) => tool.name === "mcp_invocation");
if (!filesystemCall || filesystemCall.success !== true) {
  throw new Error("Expected /filesystem to produce a successful mcp_invocation tool call");
}
if (!filesystemCall.result || filesystemCall.result.mode !== "knowledge_summary") {
  throw new Error("Expected /filesystem knowledge to execute the knowledge summary mode");
}
const filesystemFiles = filesystemCall.result.files || [];
if (!Array.isArray(filesystemFiles) || filesystemFiles.length === 0) {
  throw new Error("Expected /filesystem knowledge to return a controlled file summary");
}
const unsafeFile = filesystemFiles.find((file) => {
  const filePath = String(file.path || "");
  return filePath.includes("..") || /^[a-zA-Z]:/.test(filePath) || filePath.startsWith("/");
});
if (unsafeFile) {
  throw new Error(`Expected /filesystem to return relative safe paths only, got ${unsafeFile.path}`);
}

const gitResult = await runConversationAgent({
  message: "/git status",
  llm: { enabled: false }
});

const gitCall = gitResult.tool_calls?.find((tool) => tool.name === "mcp_invocation");
if (!gitCall || gitCall.success !== true) {
  throw new Error("Expected /git to produce a successful mcp_invocation tool call");
}
if (!gitCall.result || gitCall.result.mode !== "status_summary") {
  throw new Error("Expected /git status to execute the Git MCP status summary mode");
}
if (typeof gitCall.result.branch !== "string" || !gitCall.result.branch.trim()) {
  throw new Error("Expected /git status to return a non-empty branch");
}
if (!gitCall.result.counts || typeof gitCall.result.counts.total !== "number") {
  throw new Error("Expected /git status to return change counts");
}
const gitUnsafe = (gitCall.result.files || []).find((file) => {
  const filePath = String(file.path || "");
  return filePath.includes("..") || /^[a-zA-Z]:/.test(filePath) || filePath.startsWith("/");
});
if (gitUnsafe) {
  throw new Error(`Expected /git to return relative safe paths only, got ${gitUnsafe.path}`);
}

const projectAnalysisResult = await runConversationAgent({
  message: "/project_analysis",
  llm: { enabled: false }
});

const projectAnalysisCall = projectAnalysisResult.tool_calls?.find((tool) => tool.name === "mcp_invocation");
if (!projectAnalysisCall || projectAnalysisCall.success !== true) {
  throw new Error("Expected /project_analysis to produce a successful mcp_invocation tool call");
}
if (!projectAnalysisCall.result || projectAnalysisCall.result.mode !== "project_analysis") {
  throw new Error("Expected /project_analysis to execute project analysis mode");
}
if (!projectAnalysisCall.result.package_info || projectAnalysisCall.result.package_info.name !== "embex") {
  throw new Error("Expected /project_analysis to return package_info for embex");
}
if (!Array.isArray(projectAnalysisCall.result.directories) || projectAnalysisCall.result.directories.length === 0) {
  throw new Error("Expected /project_analysis to return directory summaries");
}
if (!Array.isArray(projectAnalysisCall.result.documents) || projectAnalysisCall.result.documents.length === 0) {
  throw new Error("Expected /project_analysis to return document summaries");
}

const missingResult = await runConversationAgent({
  message: "/not_existing_capability 测试不存在的能力",
  llm: { enabled: false }
});

const missingCall = missingResult.tool_calls?.find((tool) => tool.name === "skill_invocation");
if (!missingCall || missingCall.success !== false) {
  throw new Error("Expected missing slash command to produce a failed tracked invocation");
}

console.log(JSON.stringify({
  success: true,
  skill_tool: skillCall.name,
  skill_intent: skillResult.planner?.intent,
  gpio18_status: pinFinding.status,
  mcp_tool: mcpCall.name,
  mcp_intent: mcpResult.planner?.intent,
  mcp_mode: mcpCall.result.mode,
  filesystem_mode: filesystemCall.result.mode,
  filesystem_files: filesystemFiles.length,
  git_mode: gitCall.result.mode,
  git_branch: gitCall.result.branch,
  git_total: gitCall.result.counts.total,
  project_analysis_mode: projectAnalysisCall.result.mode,
  project_analysis_dirs: projectAnalysisCall.result.directories.length,
  project_analysis_docs: projectAnalysisCall.result.documents.length,
  missing_success: missingCall.success
}, null, 2));
