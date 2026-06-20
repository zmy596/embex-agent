import { listMcps, setMcpEnabled } from "../server/mcp/mcpRegistry.ts";

const listed = await listMcps();
if (!listed.success || !Array.isArray(listed.mcps) || listed.mcps.length < 3) {
  throw new Error("MCP registry did not load expected entries");
}

const projectAnalysis = listed.mcps.find((mcp) => mcp.name === "project_analysis");
if (!projectAnalysis) {
  throw new Error("project_analysis MCP is missing");
}

const target = listed.mcps.find((mcp) => mcp.name === "serial_hardware");
if (!target) {
  throw new Error("serial_hardware MCP is missing");
}

await setMcpEnabled("serial_hardware", false);
const disabled = await listMcps();
const disabledTarget = disabled.mcps.find((mcp) => mcp.name === "serial_hardware");
if (disabledTarget?.enabled !== false) {
  throw new Error("Failed to disable serial_hardware MCP");
}

await setMcpEnabled("serial_hardware", true);
const enabled = await listMcps();
const enabledTarget = enabled.mcps.find((mcp) => mcp.name === "serial_hardware");
if (enabledTarget?.enabled !== true) {
  throw new Error("Failed to re-enable serial_hardware MCP");
}

console.log(JSON.stringify({
  success: true,
  mcp_count: enabled.mcps.length,
  enabled_count: enabled.mcps.filter((mcp) => mcp.enabled).length,
  target: enabledTarget?.name,
  invocation: enabledTarget?.invocation
}, null, 2));
