import {
  compileAndFlashGeneratedFirmware,
  diagnoseEspLog,
  runEspClosedLoop
} from "./espToolBridge.js";
import { runLangChainEspAgent } from "./langchainEspAgent.js";
import { searchKnowledge, type KnowledgeChunk } from "./knowledge/ragStore.js";
import { appendMemoryTurn, getMemoryState } from "./memory/memoryStore.js";
import { runFilesystemMcp } from "./mcp/filesystemMcp.js";
import { runGitMcp } from "./mcp/gitMcp.js";
import { listMcps } from "./mcp/mcpRegistry.js";
import { runProjectAnalysisMcp } from "./mcp/projectAnalysisMcp.js";
import { runSerialHardwareMcp } from "./mcp/serialHardwareMcp.js";
import { analyzeEspPins } from "./skills/espPinAnalyzer.js";
import { listSkills } from "./skills/skillRegistry.js";

export interface ConversationRequest {
  message?: string;
  log?: string;
  closedLoop?: Record<string, unknown>;
  history?: Array<{ role?: string; content?: string }>;
  hardwareStatus?: Record<string, unknown>;
  peripherals?: unknown[];
  llm?: LlmConfig;
  mode?: "auto" | "chat_only";
  signal?: AbortSignal;
  progress?: (update: AgentProgressUpdate) => void;
}

export interface AgentProgressUpdate {
  stage: string;
  label: string;
  detail?: string;
  status?: "running" | "done" | "failed" | "stopped";
}

export interface LlmConfig {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  provider?: string;
  modelTimeoutMs?: number;
  recursionLimit?: number;
  compileTimeoutSec?: number;
  uploadTimeoutSec?: number;
  monitorSeconds?: number;
}

type PlannerDecision =
  | { kind: "diagnose_log"; reason: string }
  | { kind: "firmware_task"; reason: string; firmwareSpec?: FirmwareTaskSpec }
  | { kind: "closed_loop"; reason: string }
  | { kind: "chat_only"; reason: string; reply: string };

type FirmwareTaskSpec = {
  action?: "gpio_static" | "gpio_toggle" | "gpio_breathing" | "aht20_read" | "oled_message" | "buzzer_melody" | "custom";
  pins?: number[];
  levels?: Array<{ pin: number; level: "HIGH" | "LOW" }>;
  period_ms?: number;
  speed_pattern?: "constant" | "fast_slow_fast";
  description?: string;
  custom_code?: string;
};

export async function runConversationAgent(input: ConversationRequest) {
  const message = String(input.message || "").trim();
  const log = String(input.log || "").trim();
  const llmConfig = resolveLlmConfig(input.llm);
  const history = normalizeHistory(input.history);
  const memoryContext = await loadMemoryContext();
  const memoryHistory = normalizeMemoryHistory(memoryContext);
  const mergedHistory = normalizeHistory([...memoryHistory, ...history]);
  const hardwareSummary = summarizeHardware(input.hardwareStatus, input.closedLoop, input.peripherals, memoryContext);
  const knowledge = await retrieveKnowledge(message, log);
  input.progress?.({
    stage: "request_received",
    label: "接收任务",
    detail: "已收到用户输入，准备进入 Embex 统一链路。",
    status: "running"
  });

  const explicitInvocation = await resolveExplicitCapabilityInvocation(message);
  if (explicitInvocation) {
    input.progress?.({
      stage: "capability_invocation",
      label: "指定能力调用",
      detail: `已识别 ${explicitInvocation.kind}: ${explicitInvocation.definition.name}`,
      status: "running"
    });
    const response = await buildCapabilityInvocationResponse(message, explicitInvocation, knowledge, input);
    await rememberConversation(input, response, knowledge);
    return response;
  }

  if (input.mode === "chat_only") {
    input.progress?.({
      stage: "chat_only",
      label: "仅对话模式",
      detail: "正在请求模型回答，不调用 ESP 工具。",
      status: "running"
    });
    const reply = await chatWithLlm(message, log, llmConfig, input.signal, knowledge, memoryContext) || withKnowledgeNote(localChatReply(message), knowledge);
    const result = chatOnlyResult(llmConfig.enabled && Boolean(llmConfig.apiKey), reply);
    const response = {
      success: true,
      planner: {
        mode: llmConfig.enabled && llmConfig.apiKey ? `llm:${llmConfig.provider}` : "local_chat_only",
        intent: "chat_only",
        reason: "user_selected_chat_only_mode"
      },
      messages: [
        { role: "user" as const, content: message || "(empty task)" },
        { role: "assistant" as const, content: reply }
      ],
      tool_calls: knowledgeToolCalls(knowledge),
      result
    };
    await rememberConversation(input, response, knowledge);
    return response;
  }

  const langChainAttempt = await tryRunLangChainAgent(message, log, input, knowledge, memoryContext, mergedHistory);
  if (langChainAttempt.result) {
    const response = attachKnowledge({ ...langChainAttempt.result }, knowledge);
    await rememberConversation(input, response, knowledge);
    return response;
  }
  const langChainError = langChainAttempt.error;

  input.progress?.({
    stage: "offline_fallback",
    label: "离线兜底",
    detail: "模型链路不可用，使用本地兜底流程。",
    status: "running"
  });
  const decision = plan(message, log, mergedHistory, hardwareSummary);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: message || "(empty task)" }
  ];
  const toolCalls: Array<Record<string, unknown>> = [];
  toolCalls.push(...knowledgeToolCalls(knowledge));
  let result: unknown = null;

  if (decision.kind === "diagnose_log") {
    const targetLog = log || extractInlineLog(message);
    const diagnosis = await diagnoseEspLog(targetLog);
    result = {
      success: true,
      summary: "Manual log diagnosis completed.",
      steps: [
        {
          name: "manual_log",
          result: {
            success: true,
            summary: "Conversation agent selected log diagnosis.",
            log: targetLog,
            diagnosis
          }
        }
      ],
      diagnosis
    };
    toolCalls.push(toolCall("esp_diagnose_log", { log_chars: targetLog.length }, diagnosis));
    messages.push({ role: "assistant", content: "已识别为日志诊断任务，调用 ESP 日志诊断工具完成根因分析和验收证据检查。" });
  } else if (decision.kind === "firmware_task") {
    const payload = {
      ...normalizeFirmwareTask(input.closedLoop || {}, message, decision.firmwareSpec),
      ...runtimeToolOptions(input.llm)
    };
    result = await compileAndFlashGeneratedFirmware(payload, input.signal);
    toolCalls.push(toolCall("compile_and_flash_generated_firmware", payload, result));
    messages.push({
      role: "assistant",
      content: `${langChainFallbackNotice(langChainError)}${firmwareTaskReply(payload, result)}`
    });
  } else if (decision.kind === "chat_only") {
    const reply = withKnowledgeNote(decision.reply, knowledge);
    result = chatOnlyResult(true, reply);
    messages.push({ role: "assistant", content: reply });
  } else {
    const payload = {
      ...normalizeClosedLoop(input.closedLoop || {}),
      ...runtimeToolOptions(input.llm)
    };
    result = await runEspClosedLoop(payload, input.signal);
    toolCalls.push(toolCall("esp_closed_loop_compile_debug", payload, result));
    messages.push({
      role: "assistant",
      content: "已识别为 ESP 闭环开发任务，调用编译调试工具执行 PlatformIO 校验、生成工程、编译；没有串口时会安全跳过烧录。"
    });
  }

  const response = {
    success: true,
    planner: {
      mode: "offline_fallback",
      intent: decision.kind,
      reason: langChainError ? `${decision.reason}; langchain_error=${langChainError}` : decision.reason
    },
    messages,
    tool_calls: toolCalls,
    result
  };
  await rememberConversation(input, response, knowledge);
  return response;
}

async function rememberConversation(input: ConversationRequest, response: Record<string, unknown>, knowledge: KnowledgeChunk[]) {
  try {
    const responseMessages = Array.isArray(response.messages) ? response.messages : [];
    const memoryMessages = responseMessages
      .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
      .filter(Boolean)
      .map((item) => ({
        role: item?.role === "assistant" ? "assistant" as const : "user" as const,
        content: String(item?.content || "")
      }))
      .filter((item) => item.content.trim());
    if (memoryMessages.length === 0 && input.message) {
      memoryMessages.push({ role: "user", content: String(input.message) });
    }
    const planner = response.planner && typeof response.planner === "object" ? response.planner as Record<string, unknown> : {};
    const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];
    await appendMemoryTurn({
      messages: memoryMessages,
      hardware_state: {
        ...(input.hardwareStatus || {}),
        closed_loop: input.closedLoop || {},
        peripherals: enabledPeripherals(input.peripherals)
      },
      project_state: {
        planner,
        tool_calls: toolCalls.map((tool) => tool && typeof tool === "object" ? String((tool as Record<string, unknown>).name || "") : "").filter(Boolean),
        knowledge_citations: knowledge.map(compactKnowledgeHit),
        result_summary: summarizeMemoryResult(response.result)
      },
      tags: ["conversation", String(planner.intent || "unknown")]
    });
  } catch (error) {
    console.warn("Embex memory persistence failed:", error);
  }
}

type ExplicitCapabilityInvocation = {
  kind: "skill" | "mcp";
  command: string;
  query: string;
  definition: Record<string, unknown>;
};

async function resolveExplicitCapabilityInvocation(message: string): Promise<ExplicitCapabilityInvocation | null> {
  const match = message.trim().match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const command = match[1];
  const query = String(match[2] || "").trim();
  const [skillsResult, mcpsResult] = await Promise.all([listSkills(), listMcps()]);
  const skill = skillsResult.skills.find((item) => item.enabled && (item.name === command || item.invocation === `/${command}`));
  if (skill) {
    return { kind: "skill", command, query, definition: skill as unknown as Record<string, unknown> };
  }
  const mcp = mcpsResult.mcps.find((item) => item.enabled && (item.name === command || item.invocation === `/${command}`));
  if (mcp) {
    return { kind: "mcp", command, query, definition: mcp as unknown as Record<string, unknown> };
  }
  return {
    kind: "skill",
    command,
    query,
    definition: {
      name: command,
      title: command,
      enabled: false,
      description: "No enabled Skill or MCP matched this command.",
      stage: "missing"
    }
  };
}

async function buildCapabilityInvocationResponse(
  message: string,
  invocation: ExplicitCapabilityInvocation,
  knowledge: KnowledgeChunk[],
  input: ConversationRequest
) {
  const definition = invocation.definition;
  const matched = definition.enabled !== false && definition.stage !== "missing";
  const toolName = invocation.kind === "skill" ? "skill_invocation" : "mcp_invocation";
  const llmConfig = resolveLlmConfig(input.llm);
  const result = matched && invocation.kind === "skill" && String(definition.name) === "esp_pin_analyzer"
    ? await analyzeEspPins({
        message: invocation.query || message,
        boardModel: String(input.closedLoop?.board_model || input.hardwareStatus?.board_model || ""),
        hardwareStatus: input.hardwareStatus,
        closedLoop: input.closedLoop,
        peripherals: enabledPeripherals(input.peripherals)
      })
    : matched && invocation.kind === "skill" && String(definition.name) === "peripheral_project_composer"
    ? await composePeripheralProjectWithLlm({
        query: invocation.query || message,
        closedLoop: input.closedLoop,
        hardwareStatus: input.hardwareStatus,
        peripherals: enabledPeripherals(input.peripherals),
        knowledge,
        llmConfig,
        signal: input.signal
      })
    : matched && invocation.kind === "mcp" && String(definition.name) === "serial_hardware"
      ? await runSerialHardwareMcp({
          query: invocation.query,
          port: String(input.closedLoop?.port || input.hardwareStatus?.selectedPort || "")
        })
    : matched && invocation.kind === "mcp" && String(definition.name) === "filesystem"
      ? await runFilesystemMcp({
          query: invocation.query
        })
    : matched && invocation.kind === "mcp" && String(definition.name) === "git"
      ? await runGitMcp({
          query: invocation.query
        })
    : matched && invocation.kind === "mcp" && String(definition.name) === "project_analysis"
      ? await runProjectAnalysisMcp({
          query: invocation.query
        })
    : buildGenericCapabilityResult(invocation, matched);
  const reply = matched && invocation.kind === "skill" && String(definition.name) === "esp_pin_analyzer"
    ? formatPinAnalyzerReply(result as Record<string, unknown>)
    : matched && invocation.kind === "skill" && String(definition.name) === "peripheral_project_composer"
      ? formatPeripheralProjectReply(result as Record<string, unknown>)
    : matched && invocation.kind === "mcp" && String(definition.name) === "serial_hardware"
      ? formatSerialHardwareReply(result as Record<string, unknown>)
    : matched && invocation.kind === "mcp" && String(definition.name) === "filesystem"
      ? formatFilesystemReply(result as Record<string, unknown>)
    : matched && invocation.kind === "mcp" && String(definition.name) === "git"
      ? formatGitReply(result as Record<string, unknown>)
    : matched && invocation.kind === "mcp" && String(definition.name) === "project_analysis"
      ? formatProjectAnalysisReply(result as Record<string, unknown>)
    : formatGenericCapabilityReply(invocation, matched);
  return {
    success: true,
    planner: {
      mode: "capability_router",
      intent: toolName,
      reason: matched ? "explicit_slash_command_matched_enabled_capability" : "explicit_slash_command_not_found"
    },
    messages: [
      { role: "user" as const, content: message || "(empty task)" },
      { role: "assistant" as const, content: reply }
    ],
    tool_calls: [
      ...knowledgeToolCalls(knowledge),
      toolCall(toolName, { command: invocation.command, query: invocation.query }, result)
    ],
    result: chatOnlyResult(true, reply)
  };
}

function buildGenericCapabilityResult(invocation: ExplicitCapabilityInvocation, matched: boolean) {
  const definition = invocation.definition;
  return {
    success: matched,
    summary: matched
      ? `${invocation.kind.toUpperCase()} ${String(definition.name)} selected by explicit slash command.`
      : `No enabled Skill or MCP matched /${invocation.command}.`,
    capability: {
      kind: invocation.kind,
      name: String(definition.name || invocation.command),
      title: String(definition.title || definition.name || invocation.command),
      description: String(definition.description || ""),
      category: String(definition.category || "general"),
      stage: String(definition.stage || "unknown"),
      invocation: String(definition.invocation || `/${invocation.command}`),
      inputs: Array.isArray(definition.inputs) ? definition.inputs : undefined,
      outputs: Array.isArray(definition.outputs) ? definition.outputs : undefined,
      capabilities: Array.isArray(definition.capabilities) ? definition.capabilities : undefined
    },
    query: invocation.query,
    next_step: matched
      ? "当前步骤完成了指定能力选择和追踪；如果该能力已有真实执行器，会返回真实执行结果。"
      : "请在知识与能力页面启用对应 Skill/MCP，或输入已存在的 /skill_name /mcp_name。"
  };
}

function formatGenericCapabilityReply(invocation: ExplicitCapabilityInvocation, matched: boolean) {
  const definition = invocation.definition;
  if (!matched) return `未找到已启用的 /${invocation.command}。请在知识与能力页面确认 Skill/MCP 是否存在并启用。`;
  return [
    `已选择 ${invocation.kind.toUpperCase()}：${String(definition.title || definition.name)}`,
    "",
    `调用名：/${invocation.command}`,
    invocation.query ? `用户参数：${invocation.query}` : "用户参数：无",
    `用途：${String(definition.description || "")}`,
    "",
    "本轮已记录为可追踪能力调用。"
  ].join("\n");
}

function composePeripheralProject(input: {
  query: string;
  closedLoop?: Record<string, unknown>;
  hardwareStatus?: Record<string, unknown>;
  peripherals?: unknown[];
}) {
  const boardModel = String(input.closedLoop?.board_model || input.hardwareStatus?.board_model || "unknown");
  const port = String(input.closedLoop?.port || input.hardwareStatus?.selectedPort || "");
  const peripherals = summarizeConfiguredPeripherals(input.peripherals);
  const names = peripherals.map((item) => item.name.toLowerCase());
  const hasOled = names.some((name) => /oled|display|屏/.test(name));
  const hasLed = names.some((name) => /led|灯/.test(name));
  const hasBuzzer = names.some((name) => /buzzer|蜂鸣|beep/.test(name));
  const hasTempSensor = names.some((name) => /aht|dht|sht|温湿|temperature|humidity/.test(name));
  const hasLight = names.some((name) => /bh1750|light|光照/.test(name));
  const title = choosePeripheralProjectTitle({ hasOled, hasLed, hasBuzzer, hasTempSensor, hasLight });
  const roles = peripherals.map((item) => ({
    peripheral: item.name,
    role: inferPeripheralRole(item.name),
    pins: item.pins
  }));
  const firmwareFlow = [
    "初始化 Serial，输出 BOOT、板卡型号、端口和外设引脚摘要。",
    "按已配置引脚初始化各外设；未启用或未配置引脚的外设不写入主逻辑。",
    hasTempSensor || hasLight ? "周期读取传感器数据，并把读取结果通过串口输出为结构化日志。" : "",
    hasOled ? "OLED 显示项目标题、关键状态和传感器/执行器结果。" : "",
    hasLed ? "LED 作为运行状态或告警状态指示。" : "",
    hasBuzzer ? "蜂鸣器仅在告警、启动完成或用户指定事件中短鸣，避免持续占用。" : "",
    "loop 中保持非阻塞或短延时运行，并持续输出 heartbeat 便于串口验收。"
  ].filter(Boolean);
  const acceptanceChecks = [
    "编译成功，PlatformIO 输出 exit code 0。",
    port ? `烧录到当前端口 ${port} 成功。` : "如果未选择串口，先完成编译验证；选择串口后再烧录。",
    "串口日志包含 [BOOT]、[PIN]、[APP] 或 [HEARTBEAT] 等关键节点。",
    hasOled ? "OLED 屏幕显示项目标题或关键状态，内容与串口日志一致。" : "",
    hasLed ? "LED 行为符合任务描述，例如闪烁、常亮、熄灭或告警指示。" : "",
    hasBuzzer ? "蜂鸣器按任务指定节奏响起，串口同步输出 [BUZZER] 事件。" : "",
    hasTempSensor || hasLight ? "传感器读取值在串口中有明确字段；读取失败时输出错误码和下一步诊断建议。" : ""
  ].filter(Boolean);
  return {
    success: peripherals.length > 0,
    summary: peripherals.length > 0
      ? `已基于 ${peripherals.length} 个已启用外设生成小项目方案：${title}。`
      : "当前没有检测到已启用且已配置引脚的外设，无法组合小项目。",
    board_model: boardModel,
    port,
    project_idea: title,
    requested_goal: input.query,
    peripheral_roles: roles,
    firmware_flow: firmwareFlow,
    acceptance_checks: acceptanceChecks,
    next_prompt: peripherals.length > 0
      ? `请根据这个方案生成 main.cpp 并编译烧录：${title}`
    : "请先在硬件页面添加并保存至少一个已启用外设及其引脚，再调用本 Skill。"
  };
}

async function composePeripheralProjectWithLlm(input: {
  query: string;
  closedLoop?: Record<string, unknown>;
  hardwareStatus?: Record<string, unknown>;
  peripherals?: unknown[];
  knowledge: KnowledgeChunk[];
  llmConfig: Required<LlmConfig>;
  signal?: AbortSignal;
}) {
  const peripherals = summarizeConfiguredPeripherals(input.peripherals);
  const fallback = composePeripheralProject(input);
  if (!input.llmConfig.enabled || !input.llmConfig.apiKey || !input.llmConfig.baseUrl || !input.llmConfig.model) {
    return {
      ...fallback,
      planner_mode: "local_fallback",
      model_owned: false,
      fallback_used: true,
      fallback_reason: "模型未启用或模型配置不完整，已使用本地规则兜底。"
    };
  }
  const endpoint = `${input.llmConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.llmConfig.modelTimeoutMs);
  const signal = input.signal || controller.signal;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: input.llmConfig.model,
        temperature: 0.35,
        messages: [
          {
            role: "system",
            content: [
              "你是 Embex 的 peripheral_project_composer Skill。",
              "你必须由模型主导，根据用户目标、当前板卡、已启用外设、引脚和知识库命中，设计一个可落地的 ESP 嵌入式小项目。",
              "不要使用固定模板。不要假设未配置外设已经存在。不要把未启用外设写进主流程。",
              "输出必须是严格 JSON，不要 Markdown，不要代码块。",
              "JSON 字段：success, project_idea, design_reasoning, peripheral_roles, firmware_flow, acceptance_checks, risks, next_prompt。",
              "peripheral_roles 每项包含 peripheral, role, pins。firmware_flow 和 acceptance_checks 是字符串数组。",
              "next_prompt 要给出下一步可直接让 Embex 生成 main.cpp 并编译烧录的中文指令。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({
              project_goal: input.query,
              board: {
                board_model: input.closedLoop?.board_model || input.hardwareStatus?.board_model || "unknown",
                port: input.closedLoop?.port || input.hardwareStatus?.selectedPort || ""
              },
              hardwareStatus: input.hardwareStatus || {},
              peripherals,
              knowledge_hits: input.knowledge.map(compactKnowledgeHit)
            })
          }
        ]
      }),
      signal
    });
    if (!response.ok) throw new Error(`model_http_${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const parsed = parseJsonObject(content);
    if (!parsed) throw new Error("模型未返回有效 JSON。");
    return normalizeModelPeripheralProjectResult(parsed, fallback, content);
  } catch (error) {
    return {
      ...fallback,
      planner_mode: "model_failed_local_fallback",
      model_owned: false,
      fallback_used: true,
      fallback_reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObject(content: string) {
  const text = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function normalizeModelPeripheralProjectResult(model: Record<string, unknown>, fallback: Record<string, unknown>, raw: string) {
  const roles = Array.isArray(model.peripheral_roles) ? model.peripheral_roles : fallback.peripheral_roles;
  const flow = normalizeStringArray(model.firmware_flow).length ? normalizeStringArray(model.firmware_flow) : fallback.firmware_flow;
  const checks = normalizeStringArray(model.acceptance_checks).length ? normalizeStringArray(model.acceptance_checks) : fallback.acceptance_checks;
  const risks = normalizeStringArray(model.risks);
  return {
    success: model.success !== false && Boolean(fallback.success),
    summary: `模型已基于当前外设生成小项目方案：${String(model.project_idea || fallback.project_idea || "已连接外设综合验证项目")}。`,
    planner_mode: "llm_model_owned",
    model_owned: true,
    fallback_used: false,
    board_model: fallback.board_model,
    port: fallback.port,
    requested_goal: fallback.requested_goal,
    project_idea: String(model.project_idea || fallback.project_idea || "已连接外设综合验证项目"),
    design_reasoning: String(model.design_reasoning || "模型根据当前外设、引脚配置和知识库命中生成方案。"),
    peripheral_roles: roles,
    firmware_flow: flow,
    acceptance_checks: checks,
    risks,
    next_prompt: String(model.next_prompt || fallback.next_prompt || "请根据这个方案生成 main.cpp 并编译烧录。"),
    model_raw_preview: raw.slice(0, 1200)
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function summarizeConfiguredPeripherals(peripherals?: unknown[]) {
  return (peripherals || [])
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const pins = item.pins && typeof item.pins === "object" ? item.pins as Record<string, unknown> : {};
      return {
        name: String(item.name || item.templateId || item.type || "peripheral"),
        pins: Object.fromEntries(Object.entries(pins).filter(([, value]) => value !== "" && value !== null && value !== undefined))
      };
    })
    .filter((item) => Object.keys(item.pins).length > 0);
}

function choosePeripheralProjectTitle(flags: {
  hasOled: boolean;
  hasLed: boolean;
  hasBuzzer: boolean;
  hasTempSensor: boolean;
  hasLight: boolean;
}) {
  if ((flags.hasTempSensor || flags.hasLight) && flags.hasOled && (flags.hasLed || flags.hasBuzzer)) {
    return "环境监测与声光提示终端";
  }
  if (flags.hasOled && flags.hasLed) return "OLED 状态显示与 LED 运行指示器";
  if (flags.hasOled && flags.hasBuzzer) return "OLED 交互提示与蜂鸣反馈器";
  if (flags.hasTempSensor && flags.hasLed) return "温湿度阈值告警器";
  if (flags.hasLight && flags.hasLed) return "光照检测与 LED 指示器";
  return "已连接外设综合验证项目";
}

function inferPeripheralRole(name: string) {
  const text = name.toLowerCase();
  if (/oled|display|屏/.test(text)) return "显示项目状态、传感器读数和错误信息";
  if (/led|灯/.test(text)) return "输出运行状态、告警状态或用户指定灯效";
  if (/buzzer|蜂鸣|beep/.test(text)) return "输出启动提示、告警提示或简单旋律";
  if (/aht|dht|sht|温湿|temperature|humidity/.test(text)) return "采集温湿度数据并提供环境状态输入";
  if (/bh1750|light|光照/.test(text)) return "采集环境光照强度并提供阈值判断输入";
  return "作为项目中的可控外设或传感输入";
}

function formatPeripheralProjectReply(result: Record<string, unknown>) {
  const roles = Array.isArray(result.peripheral_roles) ? result.peripheral_roles as Array<Record<string, unknown>> : [];
  const flow = Array.isArray(result.firmware_flow) ? result.firmware_flow.map(String) : [];
  const checks = Array.isArray(result.acceptance_checks) ? result.acceptance_checks.map(String) : [];
  const risks = Array.isArray(result.risks) ? result.risks.map(String) : [];
  if (result.success === false) {
    return [
      "当前还不能组合小项目。",
      "",
      `原因：${String(result.summary || "没有可用外设配置。")}`,
      `下一步：${String(result.next_prompt || "先在硬件页面保存外设配置。")}`
    ].join("\n");
  }
  return [
    result.model_owned
      ? "已由模型主导生成小项目方案。"
      : `已使用本地兜底生成小项目方案。原因：${String(result.fallback_reason || "模型不可用")}`,
    "",
    `项目方案：${String(result.project_idea || "已连接外设综合验证项目")}`,
    result.design_reasoning ? `模型设计依据：${String(result.design_reasoning)}` : "",
    "",
    `目标板卡：${String(result.board_model || "unknown")}`,
    `烧录端口：${String(result.port || "未选择")}`,
    "",
    "外设分工：",
    ...(roles.length ? roles.map((item) => `- ${String(item.peripheral || "peripheral")}：${String(item.role || "")}；引脚 ${JSON.stringify(item.pins || {})}`) : ["- 当前没有可展示外设。"]),
    "",
    "固件主流程：",
    ...flow.map((item) => `- ${item}`),
    "",
    "验收标准：",
    ...checks.map((item) => `- ${item}`),
    risks.length ? "" : "",
    ...(risks.length ? ["风险与注意事项:", ...risks.map((item) => `- ${item}`)] : []),
    "",
    `下一步指令：${String(result.next_prompt || "让 Embex 基于该方案生成 main.cpp 并执行闭环。")}`
  ].filter((line) => line !== "").join("\n");
}

function formatPinAnalyzerReply(result: Record<string, unknown>) {
  const findings = Array.isArray(result.findings) ? result.findings as Array<Record<string, unknown>> : [];
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions.map(String) : [];
  const lines = [
    `已完成引脚分析：${String(result.board_name || result.board_model || "unknown")}`,
    "",
    "分析结果：",
    ...(findings.length ? findings.map((finding) => `- ${String(finding.pin)} (${String(finding.status)}): ${String(finding.recommendation || finding.evidence || "")}`) : ["- 未提取到明确 GPIO，请在指令中写明 GPIO 编号。"]),
    "",
    "建议：",
    ...suggestions.slice(0, 4).map((item) => `- ${item}`)
  ];
  return lines.join("\n");
}

function formatSerialHardwareReply(result: Record<string, unknown>) {
  const selectedPort = String(result.selected_port || "");
  const mode = String(result.mode || "list_ports");
  const lines = [
    mode === "probe_port" && selectedPort
      ? `已完成串口扫描并探测：${selectedPort}`
      : "已完成当前串口扫描。",
    "",
    `模式：${mode}`,
    `摘要：${String(result.summary || "")}`,
    "",
    `下一步：${String(result.next_step || "根据串口列表选择烧录端口。")}`
  ];
  return lines.join("\n");
}

function formatFilesystemReply(result: Record<string, unknown>) {
  const mode = String(result.mode || "project_overview");
  const counts = result.counts && typeof result.counts === "object" ? result.counts as Record<string, unknown> : {};
  const files = Array.isArray(result.files) ? result.files as Array<Record<string, unknown>> : [];
  const roots = Array.isArray(result.roots) ? result.roots.map(String) : [];
  const preview = files.slice(0, 12).map((file) => `- ${String(file.path || "")}${file.kind === "directory" ? "/" : ""}`).filter((line) => line.trim() !== "-");
  return ["已完成受控文件系统扫描。", "", `模式：${mode}`, `范围：${roots.join(", ") || "project_overview"}`, `统计：${Number(counts.files || 0)} 个文件，${Number(counts.directories || 0)} 个目录`, "", "文件摘要：", ...(preview.length ? preview : ["- 未发现可展示文件"]), "", `下一步：${String(result.next_step || "可继续指定 /filesystem knowledge、/filesystem source 或 /filesystem memory。")}`].join("\n");
}

function formatGitReply(result: Record<string, unknown>) {
  const counts = result.counts && typeof result.counts === "object" ? result.counts as Record<string, unknown> : {};
  const files = Array.isArray(result.files) ? result.files as Array<Record<string, unknown>> : [];
  const commits = Array.isArray(result.recent_commits) ? result.recent_commits as Array<Record<string, unknown>> : [];
  const preview = files.slice(0, 12).map((file) => `- ${String(file.status || "changed")}: ${String(file.path || "")}`).filter((line) => line.trim() !== "- changed:");
  const commitPreview = commits.slice(0, 3).map((commit) => `- ${String(commit.hash || "")} ${String(commit.subject || "")}`.trim()).filter(Boolean);
  return ["已完成 Git 工作区状态扫描。", "", `分支：${String(result.branch || "unknown")}`, result.upstream ? `上游：${String(result.upstream)}` : "上游：未配置或未检测到", `ahead/behind：${Number(result.ahead || 0)} / ${Number(result.behind || 0)}`, `工作区：${result.is_dirty ? "有未提交改动" : "干净"}`, `统计：modified=${Number(counts.modified || 0)}, added=${Number(counts.added || 0)}, deleted=${Number(counts.deleted || 0)}, untracked=${Number(counts.untracked || 0)}, total=${Number(counts.total || 0)}`, "", "改动摘要：", ...(preview.length ? preview : ["- 无未提交改动"]), "", "最近提交：", ...(commitPreview.length ? commitPreview : ["- 暂无可展示提交"]), "", `下一步：${String(result.next_step || "Git MCP 当前只读；需要提交时先审阅改动摘要。")}`].join("\n");
}

function formatProjectAnalysisReply(result: Record<string, unknown>) {
  const packageInfo = result.package_info && typeof result.package_info === "object" ? result.package_info as Record<string, unknown> : {};
  const directories = Array.isArray(result.directories) ? result.directories as Array<Record<string, unknown>> : [];
  const documents = Array.isArray(result.documents) ? result.documents as Array<Record<string, unknown>> : [];
  const configs = Array.isArray(result.config_files) ? result.config_files as Array<Record<string, unknown>> : [];
  const risks = Array.isArray(result.risks) ? result.risks.map(String) : [];
  const dirPreview = directories.slice(0, 8).map((item) => `- ${String(item.path || "")}: files=${Number(item.files || 0)}, dirs=${Number(item.directories || 0)}`).filter((line) => !line.startsWith("- :"));
  const docPreview = documents.slice(0, 6).map((item) => `- ${String(item.path || "")}: ${String(item.title || "")}`).filter((line) => !line.startsWith("- :"));
  return ["已完成项目 / 文档分析。", "", `项目：${String(packageInfo.name || "unknown")} ${String(packageInfo.version || "")}`.trim(), `脚本数量：${Array.isArray(packageInfo.scripts) ? packageInfo.scripts.length : 0}`, `依赖数量：${Array.isArray(packageInfo.dependencies) ? packageInfo.dependencies.length : 0}`, `配置文件：${configs.length}`, "", "目录摘要：", ...(dirPreview.length ? dirPreview : ["- 未发现可分析目录"]), "", "文档摘要：", ...(docPreview.length ? docPreview : ["- 未发现可分析文档"]), "", "风险 / 提醒：", ...(risks.length ? risks.slice(0, 5).map((risk) => `- ${risk}`) : ["- 暂无"]), "", `下一步：${String(result.next_step || "可结合 /filesystem source 和 /git status 继续分析。")}`].join("\n");
}

async function tryRunLangChainAgent(
  message: string,
  log: string,
  input: ConversationRequest,
  knowledge: KnowledgeChunk[],
  memoryContext: Record<string, unknown>,
  mergedHistory: Array<{ role: string; content: string }>
) {
  if (!input.llm?.enabled) return { result: null, error: "" };
  try {
    input.progress?.({
      stage: "model_reasoning",
      label: "模型规划",
      detail: "Embex 正在基于当前硬件、历史对话和外设配置判断是否调用工具。",
      status: "running"
    });
    return {
      result: await runLangChainEspAgent({
        message,
        log,
        hardware: input.closedLoop || {},
        history: mergedHistory,
        hardwareStatus: input.hardwareStatus || {},
        peripherals: enabledPeripherals(input.peripherals),
        knowledge,
        memory: memoryContext,
        llm: input.llm,
        signal: input.signal,
        progress: input.progress
      }),
      error: ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Embex model chain failed, falling back to local planner:", error);
    input.progress?.({
      stage: "model_failed",
      label: "模型链路失败",
      detail: message,
      status: "failed"
    });
    return { result: null, error: message };
  }
}

function langChainFallbackNotice(error: string) {
  if (!error) return "";
  return `> 模型链路失败，已进入本地兜底：${error}\n\n`;
}

async function chatWithLlm(
  message: string,
  log: string,
  config: Required<LlmConfig>,
  signal?: AbortSignal,
  knowledge: KnowledgeChunk[] = [],
  memoryContext: Record<string, unknown> = {}
): Promise<string | null> {
  if (!config.enabled || !config.apiKey || !config.baseUrl || !config.model) return null;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.5,
        messages: [
          {
            role: "system",
            content: [
              "你是 Embex，面向研电赛作品的嵌入式开发调试智能体。",
              "当前是仅对话测试模式，不允许调用工具，不允许触发编译、烧录、串口读取。",
              "可以解释系统能力、分析用户描述、给出下一步建议。",
              "回答要完整、分步骤、适合比赛答辩说明。",
              "除非用户明确要求简短，否则需要说明判断依据、执行流程、风险点和下一步建议。",
              "如果用户询问系统实现或演示流程，优先用清晰小标题和条目回答。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ task: message, pasted_log: log })
          },
          {
            role: "user",
            content: JSON.stringify({ embex_knowledge_hits: knowledge.map(compactKnowledgeHit) })
          },
          {
            role: "user",
            content: JSON.stringify({ embex_memory_context: memoryContext })
          }
        ]
      }),
      signal: signal || controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveKnowledge(message: string, log: string) {
  const query = `${message}\n${log}`.trim();
  if (!query) return [];
  if (!shouldRetrieveKnowledge(message, log)) return [];
  try {
    const result = await searchKnowledge(query, 4) as { hits?: KnowledgeChunk[] };
    return Array.isArray(result.hits) ? result.hits : [];
  } catch {
    return [];
  }
}

function shouldRetrieveKnowledge(message: string, log: string) {
  const text = message.trim();
  if (log.trim()) return true;
  if (!text) return false;

  if (/^(你好|您好|hello|hi|hey|在吗|测试|test|\d+)[，。？！\s!?.]*$/i.test(text)) return false;
  if (/(当前|目前|现在).{0,12}(连接状态|硬件状态|硬件配置|配置状态)/.test(text)) return false;

  if (/^\/(knowledge|rag|esp_pin_analyzer|peripheral_project_composer|filesystem|project_analysis|serial_hardware|git)\b/i.test(text)) {
    return true;
  }

  return /(esp32|esp8266|esp\b|gpio\d*|oled|ssd1306|sh1106|u8g2|led|蜂鸣器|buzzer|aht20|dht11|dht22|bh1750|i2c|spi|uart|pwm|adc|dac|platformio|main\.cpp|arduino|firmware|固件|编译|烧录|上传|串口|日志|引脚|外设|板卡|开发板|接线|电平|vcc|gnd|供电|看门狗|watchdog|brownout|boot|strapping|复位|知识库|rag|mcp|skill|工具|闭环|react|错误|失败|诊断|调试|报错|端口|com\d+)/i.test(text);
}

function knowledgeToolCalls(knowledge: KnowledgeChunk[]) {
  if (knowledge.length === 0) return [];
  return [toolCall("rag_knowledge_search", { top_k: knowledge.length }, {
    success: true,
    summary: `知识库命中 ${knowledge.length} 条片段。`,
    citations: knowledge.map(compactKnowledgeHit)
  })];
}

function attachKnowledge(result: Record<string, unknown>, knowledge: KnowledgeChunk[]) {
  if (knowledge.length === 0) return result;
  return {
    ...result,
    tool_calls: [...knowledgeToolCalls(knowledge), ...(Array.isArray(result.tool_calls) ? result.tool_calls : [])],
    result: result.result && typeof result.result === "object"
      ? { ...result.result as Record<string, unknown>, knowledge_citations: knowledge.map(compactKnowledgeHit) }
      : result.result
  };
}

function withKnowledgeNote(reply: string, knowledge: KnowledgeChunk[]) {
  return reply;
}

function compactKnowledgeHit(hit: KnowledgeChunk) {
  return {
    id: hit.id,
    document_id: hit.document_id,
    title: hit.title,
    filename: hit.filename,
    chunk_index: hit.chunk_index,
    source: hit.source,
    score: (hit as KnowledgeChunk & { score?: number }).score,
    text: hit.text.length > 360 ? `${hit.text.slice(0, 360)}...` : hit.text
  };
}

function chatOnlyResult(modelAttempted: boolean, reply: string) {
  return {
    success: true,
    summary: modelAttempted ? "LLM chat response completed without tool calls." : "Local chat-only response completed without tool calls.",
    steps: [],
    diagnosis: {
      root_cause: "chat_only",
      confidence: modelAttempted ? 0.9 : 0.6,
      next_step: "如果需要执行硬件闭环，请直接描述要让开发板完成的动作。",
      findings: [
        {
          kind: "chat_only",
          severity: "info",
          evidence: reply,
          action: "本轮没有执行编译、烧录、串口读取或 ESP 工具。"
        }
      ]
    }
  };
}

function localChatReply(message: string) {
  const text = message.trim();
  if (!text) return "我是 Embex，面向 ESP 系列开发板的代码生成、编译、烧录、串口监控和调试智能体。你可以直接告诉我要控制哪个 GPIO、连接了哪些外设，或把串口日志发给我分析。";
  if (/^(你好|您好|hello|hi|hey|在吗|测试|test)[，。？\s]*$/i.test(text)) {
    return "你好，我是 Embex。你可以直接告诉我 ESP 开发板要完成的动作，或者把接线、串口日志、报错信息发给我分析。";
  }
  if (/你是谁|介绍一下|能做什么|帮助|怎么用|^功能介绍$|^功能$/.test(text)) {
    return "我是 Embex，专门面向 ESP32、ESP32-S3、ESP32-C3、ESP8266 等 ESP 系列开发。核心流程是理解任务、选择或生成 main.cpp、创建 PlatformIO 工程、编译、按当前串口烧录、读取串口日志，再根据日志分析并决定是否修改代码重试。";
  }
  if (/GPIO\s*\d+/i.test(text) && /(功能|作用|是什么|能不能|适合|引脚)/.test(text)) {
    return "GPIO 引脚功能需要结合当前开发板型号和引脚表判断。本轮只做信息分析，不会编译或烧录；如果要基于当前板卡做精确判断，可以使用 /esp_pin_analyzer，或在硬件页查看该型号的引脚功能图。";
  }
  if (/(当前|目前|现在).{0,12}(连接状态|硬件状态|硬件配置|配置状态)/.test(text)) {
    return "这是当前状态查询。本轮不会编译或烧录；请以硬件配置页保存的板卡、串口、外设和引脚信息为准。如果要读取真实串口或验证硬件现象，可以直接说“读取串口日志”或“执行一次硬件验证”。";
  }
  return `我理解你的问题是：“${text}”。这更像信息查询，本轮不会自动编译、烧录或读取串口。需要硬件闭环时，可以直接说“GPIO12 拉高”“OLED 显示中文”“读取串口日志并诊断”等具体任务。`;
}

function normalizeHistory(history?: Array<{ role?: string; content?: string }>) {
  return (history || [])
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").trim()
    }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

function enabledPeripherals(peripherals?: unknown[]) {
  return (peripherals || []).filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).enabled !== false);
}

async function loadMemoryContext() {
  try {
    const memory = await getMemoryState();
    return {
      long_term_summary: memory.state.long_term_summary || "",
      short_term_context: (memory.state.short_term_context || []).slice(-8),
      hardware_state: memory.state.hardware_state || {},
      project_state: memory.state.project_state || {},
      project_facts: memory.state.project_facts || [],
      user_preferences: memory.state.user_preferences || [],
      failure_cases: memory.state.failure_cases || [],
      updated_at: memory.state.updated_at || ""
    };
  } catch {
    return {};
  }
}

function normalizeMemoryHistory(memoryContext: Record<string, unknown>) {
  const shortTerm = Array.isArray(memoryContext.short_term_context) ? memoryContext.short_term_context : [];
  const history = shortTerm
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "")
    }))
    .filter((item) => item.content.trim());
  const projectFacts = Array.isArray(memoryContext.project_facts) ? memoryContext.project_facts.map(String).filter(Boolean) : [];
  const summary = [
    memoryContext.long_term_summary ? `long_term_summary: ${String(memoryContext.long_term_summary)}` : "",
    projectFacts.length ? `project_facts: ${projectFacts.join(" ; ")}` : ""
  ].filter(Boolean).join("\n");
  return summary ? [{ role: "user", content: `[Embex memory]\n${summary}` }, ...history] : history;
}

function summarizeHardware(
  hardwareStatus?: Record<string, unknown>,
  closedLoop?: Record<string, unknown>,
  peripherals?: unknown[],
  memoryContext?: Record<string, unknown>
) {
  const memoryHardware = memoryContext?.hardware_state && typeof memoryContext.hardware_state === "object"
    ? memoryContext.hardware_state as Record<string, unknown>
    : {};
  const rememberedClosedLoop = memoryHardware.closed_loop && typeof memoryHardware.closed_loop === "object"
    ? memoryHardware.closed_loop as Record<string, unknown>
    : {};
  const hardware = { ...memoryHardware, ...(hardwareStatus || {}) };
  const form = { ...rememberedClosedLoop, ...(closedLoop || {}) };
  const peripheralSummary = Array.isArray(peripherals)
    ? peripherals.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return (item as Record<string, unknown>).enabled !== false;
      }).slice(0, 8).map((item) => {
        if (!item || typeof item !== "object") return "";
        const record = item as Record<string, unknown>;
        const pins = record.pins && typeof record.pins === "object" ? JSON.stringify(record.pins) : "{}";
        return `${String(record.name || "peripheral")}=${pins}`;
      }).filter(Boolean).join(" ; ")
    : "";
  return [
    `board_model=${String(form.board_model || hardware.board_model || "unknown")}`,
    `port=${String(form.port || hardware.selectedPort || "") || "none"}`,
    `ready_for_compile=${String(hardware.readyForCompile ?? hardware.ready_for_compile ?? "")}`,
    `ready_for_upload=${String(hardware.readyForUpload ?? hardware.ready_for_upload ?? "")}`,
    `ports=${Array.isArray(hardware.availablePorts) ? hardware.availablePorts.join(",") : ""}`,
    `board_pin_map=${JSON.stringify((hardware as { boardPinMap?: unknown }).boardPinMap || {})}`,
    `peripherals=${peripheralSummary || "none"}`
  ].join(" | ");
}

function plan(message: string, log: string, history: Array<{ role: string; content: string }>, hardwareSummary: string): PlannerDecision {
  const currentText = `${message}\n${log}`.toLowerCase();
  const contextText = `${message}\n${log}\n${history.slice(-6).map((item) => item.content).join("\n")}\n${hardwareSummary}`.toLowerCase();
  if (log || /\[(boot|error|data|i2c|aht20|oled|brownout|system|led|buzzer)\]/i.test(message)) {
    return { kind: "diagnose_log" as const, reason: "message_or_log_contains_structured_runtime/build_log" };
  }
  if (isFirmwareTask(currentText)) {
    return {
      kind: "firmware_task" as const,
      reason: "task_requests_concrete_peripheral_behavior",
      firmwareSpec: inferLocalFirmwareSpec(message)
    };
  }
  if (hasExecutionIntent(currentText) && isClosedLoopTask(contextText)) {
    return { kind: "closed_loop" as const, reason: "task_requests_full_esp_compile_debug_workflow" };
  }
  if (isInformationQuery(message)) {
    return { kind: "chat_only" as const, reason: "information_query_without_execution_intent", reply: localChatReply(message) };
  }
  return { kind: "chat_only" as const, reason: "no_esp_tool_intent_detected", reply: localChatReply(message) };
}

function isFirmwareTask(text: string) {
  if (!hasExecutionIntent(text)) return false;
  if (/gpio\s*\d+/i.test(text)) return true;
  return /点亮|打开|关闭|熄灭|闪烁|呼吸|led|蜂鸣器|buzzer|生日快乐|happy birthday|播放|旋律|温度|湿度|温湿度|aht20|dht11|oled|显示屏|屏幕|显示/.test(text);
}

function hasExecutionIntent(text: string) {
  return /执行|运行|跑一下|跑一遍|烧录|上传|编译|生成|写入|下载到|测试一下|验证一下|让.*显示|显示.*到|oled.*显示|屏幕.*显示|显示.*oled|点亮|打开|关闭|熄灭|闪烁|呼吸|拉高|拉低|置高|置低|高电平|低电平|控制|读取|采集|播放|鸣叫|beep|run|execute|flash|upload|compile|build|test|verify|set\s+(high|low)|turn\s+(on|off)|blink|toggle|read|show|display/.test(text);
}

function isInformationQuery(message: string) {
  const text = message.trim().toLowerCase();
  if (hasExecutionIntent(text)) return false;
  return /^(当前|现在)?(我|我的)?.*(引脚|接线|连接|配置)|怎么接|接到哪|是什么|啥意思|为什么|为啥|区别|解释|介绍|说明|流程|原理|能不能|是否|是不是|哪些|多少|what|why|how|explain|difference/.test(text);
}

function inferLocalFirmwareSpec(message: string): FirmwareTaskSpec | undefined {
  const text = message.trim();
  if (!/\bgpio\s*\d+\b/i.test(text)) return undefined;
  const pins = [...new Set([...text.matchAll(/GPIO\s*(\d+)/gi)].map((match) => Number(match[1])).filter((pin) => Number.isInteger(pin) && pin >= 0 && pin <= 48))];
  if (pins.length === 0) return undefined;
  const staticActions = extractStaticGpioActions(text);
  if (staticActions.length > 0) {
    return {
      action: "gpio_static",
      levels: staticActions,
      description: text
    };
  }
  if (/呼吸灯|呼吸|breath|breathing|fade|fading/i.test(text)) {
    return {
      action: "gpio_breathing",
      pins,
      speed_pattern: /快到慢|慢到快|fast.*slow|slow.*fast/i.test(text) ? "fast_slow_fast" : "constant",
      description: text
    };
  }
  if (pins.length > 1 || /交替|轮流|闪烁|alternate|alternating|blink|toggle/i.test(text)) {
    return {
      action: "gpio_toggle",
      pins,
      period_ms: inferPeriodMs(text),
      description: text
    };
  }
  return undefined;
}

function isClosedLoopTask(text: string) {
  return /esp|开发板|固件|main\.(c|cpp)|platformio|编译|烧录|上传|串口|日志|调试|闭环|工程|board|firmware|compile|flash|upload|serial|monitor|debug/.test(text);
}

function normalizeFirmwareSpec(value: unknown): FirmwareTaskSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const allowedActions = new Set([
    "gpio_static",
    "gpio_toggle",
    "gpio_breathing",
    "aht20_read",
    "oled_message",
    "buzzer_melody",
    "custom"
  ]);
  const action = allowedActions.has(String(raw.action)) ? String(raw.action) as FirmwareTaskSpec["action"] : undefined;
  const pins = Array.isArray(raw.pins)
    ? [...new Set(raw.pins.map((pin) => Number(pin)).filter((pin) => Number.isInteger(pin) && pin >= 0 && pin <= 48))]
    : undefined;
  const levels = Array.isArray(raw.levels)
    ? raw.levels
      .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
      .filter(Boolean)
      .map((item) => ({
        pin: Number(item?.pin),
        level: String(item?.level).toUpperCase() === "LOW" ? "LOW" as const : "HIGH" as const
      }))
      .filter((item) => Number.isInteger(item.pin) && item.pin >= 0 && item.pin <= 48)
    : undefined;
  const period = Number(raw.period_ms);
  return {
    action,
    pins,
    levels,
    period_ms: Number.isFinite(period) ? Math.max(50, Math.trunc(period)) : undefined,
    speed_pattern: raw.speed_pattern === "fast_slow_fast" ? "fast_slow_fast" : raw.speed_pattern === "constant" ? "constant" : undefined,
    description: raw.description ? String(raw.description) : undefined,
    custom_code: raw.custom_code ? String(raw.custom_code) : undefined
  };
}

function resolveLlmConfig(input?: LlmConfig): Required<LlmConfig> {
  return {
    enabled: Boolean(input?.enabled ?? process.env.LLM_ENABLED === "true"),
    provider: String(input?.provider || process.env.LLM_PROVIDER || "openai-compatible"),
    baseUrl: String(input?.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1"),
    apiKey: String(input?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ""),
    model: String(input?.model || process.env.LLM_MODEL || "gpt-4o-mini"),
    modelTimeoutMs: clampNumber(input?.modelTimeoutMs ?? process.env.CHIPWIZ_MODEL_TIMEOUT_MS, 30_000, 600_000, 600_000),
    recursionLimit: clampNumber(input?.recursionLimit ?? process.env.CHIPWIZ_REACT_RECURSION_LIMIT, 1, 20, 8),
    compileTimeoutSec: clampNumber(input?.compileTimeoutSec ?? process.env.CHIPWIZ_COMPILE_TIMEOUT_SEC, 60, 1800, 600),
    uploadTimeoutSec: clampNumber(input?.uploadTimeoutSec ?? process.env.CHIPWIZ_UPLOAD_TIMEOUT_SEC, 30, 600, 180),
    monitorSeconds: clampNumber(input?.monitorSeconds ?? process.env.CHIPWIZ_MONITOR_SECONDS, 1, 120, 8)
  };
}

function runtimeToolOptions(input?: LlmConfig) {
  return {
    compile_timeout_sec: clampNumber(input?.compileTimeoutSec ?? process.env.CHIPWIZ_COMPILE_TIMEOUT_SEC, 60, 1800, 600),
    upload_timeout_sec: clampNumber(input?.uploadTimeoutSec ?? process.env.CHIPWIZ_UPLOAD_TIMEOUT_SEC, 30, 600, 180),
    monitor_seconds: clampNumber(input?.monitorSeconds ?? process.env.CHIPWIZ_MONITOR_SECONDS, 1, 120, 8)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function toolCall(name: string, args: Record<string, unknown>, result: unknown) {
  return {
    name,
    args,
    success: extractSuccess(result),
    summary: extractSummary(result),
    result
  };
}

function extractSuccess(result: unknown) {
  if (result && typeof result === "object" && "success" in result) return Boolean((result as { success?: unknown }).success);
  return true;
}

function extractSummary(result: unknown) {
  if (result && typeof result === "object" && "summary" in result) return String((result as { summary?: unknown }).summary || "");
  if (result && typeof result === "object" && "root_cause" in result) return `root_cause=${String((result as { root_cause?: unknown }).root_cause)}`;
  return "";
}

function summarizeMemoryResult(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.summary === "string") return record.summary.slice(0, 500);
  if (record.diagnosis && typeof record.diagnosis === "object") {
    const diagnosis = record.diagnosis as Record<string, unknown>;
    return [diagnosis.root_cause, diagnosis.next_step].filter(Boolean).map(String).join(" | ").slice(0, 500);
  }
  return JSON.stringify(record).slice(0, 500);
}

function extractInlineLog(message: string) {
  return message
    .split(/\r?\n/)
    .filter((line) => /\[(boot|error|data|i2c|aht20|oled|brownout|system|led|buzzer)\]/i.test(line))
    .join("\n");
}

function normalizeClosedLoop(input: Record<string, unknown>) {
  return {
    project_name: String(input.project_name || "esp_conversation_task"),
    board_model: inferBoardModel(String(input.board_model || ""), ""),
    board: String(input.board || ""),
    port: String(input.port || "").trim() || undefined,
    flash_size: String(input.flash_size || ""),
    memory_type: String(input.memory_type || ""),
    partitions: String(input.partitions || ""),
    sda_pin: toInt(input.sda_pin, -1),
    scl_pin: toInt(input.scl_pin, -1),
    oled_clk_pin: toInt(input.oled_clk_pin, -1),
    oled_mosi_pin: toInt(input.oled_mosi_pin, -1),
    oled_reset_pin: toInt(input.oled_reset_pin, -1),
    oled_dc_pin: toInt(input.oled_dc_pin, -1),
    oled_protocol: String(input.oled_protocol || "auto"),
    led_pin: toInt(input.led_pin, -1),
    buzzer_pin: toInt(input.buzzer_pin, -1)
  };
}

function normalizeFirmwareTask(input: Record<string, unknown>, message: string, firmwareSpec?: FirmwareTaskSpec) {
  const existingCustomCode = String(input.custom_code || "");
  const generatedSpecCode = existingCustomCode ? "" : generateFirmwareFromSpec(firmwareSpec, message);
  const generatedGpioCode = existingCustomCode || generatedSpecCode ? "" : generateGpioFirmwareFromMessage(message);
  const customCode = existingCustomCode || generatedSpecCode || generatedGpioCode;
  return {
    task_description: message,
    task: customCode ? "custom" : String(input.task || "auto"),
    custom_code: customCode,
    project_name: String(input.project_name || "esp_firmware_task"),
    board_model: inferBoardModel(String(input.board_model || ""), message),
    board: String(input.board || ""),
    port: String(input.port || "").trim() || undefined,
    flash_size: String(input.flash_size || ""),
    memory_type: String(input.memory_type || ""),
    partitions: String(input.partitions || ""),
    sda_pin: toInt(input.sda_pin, -1),
    scl_pin: toInt(input.scl_pin, -1),
    oled_clk_pin: toInt(input.oled_clk_pin, -1),
    oled_mosi_pin: toInt(input.oled_mosi_pin, -1),
    oled_reset_pin: toInt(input.oled_reset_pin, -1),
    oled_dc_pin: toInt(input.oled_dc_pin, -1),
    oled_protocol: String(input.oled_protocol || "auto"),
    led_pin: toInt(input.led_pin, -1),
    buzzer_pin: toInt(input.buzzer_pin, -1),
    oled_text: String(input.oled_text || message || "Hello from Embex")
  };
}

function generateFirmwareFromSpec(spec: FirmwareTaskSpec | undefined, sourceText: string) {
  if (!spec?.action) return "";
  if (spec.custom_code) return spec.custom_code;
  if (spec.action === "gpio_breathing") {
    const pins = spec.pins?.length ? spec.pins : [];
    return pins.length ? gpioBreathingFirmware(pins, spec.description || sourceText) : "";
  }
  if (spec.action === "gpio_toggle") {
    const pins = spec.pins?.length ? spec.pins : [];
    return pins.length ? gpioToggleFirmware(pins, spec.period_ms || 1000, spec.description || sourceText) : "";
  }
  if (spec.action === "gpio_static") {
    const levels = spec.levels?.length ? spec.levels : [];
    return levels.length ? gpioStaticFirmware(levels, spec.description || sourceText) : "";
  }
  return "";
}

function toInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function inferBoardModel(configured: string, message: string) {
  const text = `${configured} ${message}`.toLowerCase();
  if (/luatos|airm2m|合宙|核心板/.test(text) && /c3|esp32-?c3|esp32c3/.test(text)) return "luatos-esp32c3-core";
  if (/c3.*devkitc|devkitc-?02|esp32-?c3-?devkitc/.test(text)) return "esp32-c3-devkitc-02";
  if (/esp32-?c3|c3\s*系列|c3\s*devkitm|devkitm-?1/.test(text)) return "esp32-c3-devkitm-1";
  if (/n16r8|16\s*mb.*r8|r8.*16\s*mb/.test(text)) return "esp32-s3-n16r8";
  if (/n8r8|8\s*mb.*r8|r8.*8\s*mb/.test(text)) return "esp32-s3-n8r8";
  if (/esp32-?s3.*n8|n8\b/.test(text)) return "esp32-s3-n8";
  if (/wrover/.test(text)) return "esp32-wrover";
  if (/esp32\s*devkit|devkit\s*v1|wroom|普通\s*esp32/.test(text)) return "esp32-devkit-v1";
  if (/devkitc/.test(text)) return "esp32-s3-devkitc-1";
  return configured || "esp32-s3-n16r8";
}

type GpioAction = { pin: number; level: "HIGH" | "LOW" };

function generateGpioFirmwareFromMessage(message: string) {
  const text = message.trim();
  if (!/\bgpio\s*\d+\b/i.test(text)) return "";

  const pins = [...new Set([...text.matchAll(/GPIO\s*(\d+)/gi)].map((match) => Number(match[1])).filter((pin) => Number.isInteger(pin)))];
  if (pins.length === 0) return "";

  const wantsBreathing = /呼吸灯|呼吸|breath|breathing|fade|fading/i.test(text);
  if (wantsBreathing) return gpioBreathingFirmware(pins, text);

  const wantsToggle = pins.length > 1 || /交替|轮流|闪烁|alternate|alternating|blink|toggle/i.test(text);
  if (wantsToggle) return gpioToggleFirmware(pins, inferPeriodMs(text), text);

  const actions = extractStaticGpioActions(text);
  if (actions.length === 0) return "";
  return gpioStaticFirmware(actions, text);
}

function extractStaticGpioActions(text: string): GpioAction[] {
  const actions: GpioAction[] = [];
  const patterns: Array<[RegExp, "HIGH" | "LOW"]> = [
    [/(?:拉高|置高|高电平|输出高|set\s+high|high)\s*GPIO\s*(\d+)/gi, "HIGH"],
    [/GPIO\s*(\d+)\s*(?:拉高|置高|高电平|输出高|set\s+high|high)/gi, "HIGH"],
    [/(?:拉低|置低|低电平|输出低|set\s+low|low)\s*GPIO\s*(\d+)/gi, "LOW"],
    [/GPIO\s*(\d+)\s*(?:拉低|置低|低电平|输出低|set\s+low|low)/gi, "LOW"]
  ];
  for (const [pattern, level] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const pin = Number(match[1]);
      if (Number.isInteger(pin)) actions.push({ pin, level });
    }
  }
  const deduped = new Map<number, GpioAction>();
  for (const action of actions) deduped.set(action.pin, action);
  return [...deduped.values()];
}

function inferPeriodMs(text: string) {
  const seconds = text.match(/(?:周期|间隔|每|every)?\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/i);
  if (seconds) return Math.max(50, Math.round(Number(seconds[1]) * 1000));
  const ms = text.match(/(?:周期|间隔|每|every)?\s*(\d+)\s*(?:ms|毫秒)/i);
  if (ms) return Math.max(50, Number(ms[1]));
  return 1000;
}

function gpioStaticFirmware(actions: GpioAction[], sourceText: string) {
  const setupPins = actions.map((action) => `  pinMode(${action.pin}, OUTPUT);\n  digitalWrite(${action.pin}, ${action.level});\n  Serial.println("[GPIO] GPIO${action.pin}=${action.level}");`).join("\n");
  const loopPins = actions.map((action) => `  digitalWrite(${action.pin}, ${action.level});`).join("\n");
  return `#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("[BOOT] Embex GPIO static firmware start");
  Serial.println("[TASK] ${escapeCppString(sourceText.slice(0, 96))}");
${setupPins}
  Serial.println("[SYSTEM] setup complete");
}

void loop() {
${loopPins}
  delay(1000);
}
`;
}

function gpioToggleFirmware(pins: number[], periodMs: number, sourceText: string) {
  const pinArray = pins.join(", ");
  const initPins = pins.map((pin) => `  pinMode(${pin}, OUTPUT);\n  digitalWrite(${pin}, LOW);`).join("\n");
  return `#include <Arduino.h>

const int GPIO_PINS[] = {${pinArray}};
const int GPIO_COUNT = sizeof(GPIO_PINS) / sizeof(GPIO_PINS[0]);
const int PERIOD_MS = ${periodMs};
int activeIndex = 0;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("[BOOT] Embex GPIO toggle firmware start");
  Serial.println("[TASK] ${escapeCppString(sourceText.slice(0, 96))}");
${initPins}
  Serial.println("[SYSTEM] setup complete");
}

void loop() {
  for (int i = 0; i < GPIO_COUNT; i++) {
    digitalWrite(GPIO_PINS[i], i == activeIndex ? HIGH : LOW);
  }
  Serial.printf("[GPIO] active=GPIO%d period_ms=%d\\n", GPIO_PINS[activeIndex], PERIOD_MS);
  activeIndex = (activeIndex + 1) % GPIO_COUNT;
  delay(PERIOD_MS);
}
`;
}

function gpioBreathingFirmware(pins: number[], sourceText: string) {
  const pinArray = pins.join(", ");
  const initPins = pins.map((pin, index) => `  ledcSetup(${index}, PWM_FREQ, PWM_RESOLUTION);\n  ledcAttachPin(${pin}, ${index});\n  ledcWrite(${index}, 0);`).join("\n");
  return `#include <Arduino.h>

const int GPIO_PINS[] = {${pinArray}};
const int GPIO_COUNT = sizeof(GPIO_PINS) / sizeof(GPIO_PINS[0]);
const int PWM_FREQ = 5000;
const int PWM_RESOLUTION = 8;
const int MAX_DUTY = 255;
const int MIN_STEP_DELAY_MS = 3;
const int MAX_STEP_DELAY_MS = 18;
int activeIndex = 0;
int duty = 0;
int direction = 1;
int speedPhase = 0;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("[BOOT] Embex GPIO breathing firmware start");
  Serial.println("[TASK] ${escapeCppString(sourceText.slice(0, 96))}");
${initPins}
  Serial.println("[SYSTEM] setup complete");
}

void loop() {
  for (int i = 0; i < GPIO_COUNT; i++) {
    ledcWrite(i, i == activeIndex ? duty : 0);
  }

  duty += direction * 3;
  if (duty >= MAX_DUTY) {
    duty = MAX_DUTY;
    direction = -1;
  } else if (duty <= 0) {
    duty = 0;
    direction = 1;
    activeIndex = (activeIndex + 1) % GPIO_COUNT;
    speedPhase = (speedPhase + 1) % 120;
    Serial.printf("[GPIO] breathing active=GPIO%d speed_phase=%d\\n", GPIO_PINS[activeIndex], speedPhase);
  }

  int wave = speedPhase < 60 ? speedPhase : 119 - speedPhase;
  int stepDelay = MAX_STEP_DELAY_MS - ((MAX_STEP_DELAY_MS - MIN_STEP_DELAY_MS) * wave / 59);
  delay(stepDelay);
}
`;
}

function firmwareTaskReply(payload: ReturnType<typeof normalizeFirmwareTask>, result: unknown) {
  const steps = extractSteps(result);
  const generated = stepResult(steps, "generate_firmware_task");
  const task = String(generated?.task || payload.task || "auto");
  const board = generated?.board && typeof generated.board === "object"
    ? generated.board as Record<string, unknown>
    : {};
  const failedStep = steps.find((step) => step.result?.success === false);
  const skippedStep = steps.find((step) => step.result?.success === null);
  const finalSuccess = result && typeof result === "object" && "success" in result
    ? Boolean((result as { success?: unknown }).success)
    : !failedStep;

  const lines = [
    finalSuccess ? "## 执行完成" : "## 执行未完成",
    "",
    `任务：${describeFirmwareTask(payload.task_description, task)}`,
    `目标板卡：${String(board.label || payload.board_model)}`,
    `烧录端口：${payload.port || "未选择"}`,
    "",
    "### 流程节点",
    "| 节点 | 状态 | 说明 |",
    "|---|---|---|",
    ...steps.map((step) => `| ${stepLabel(step.name)} | ${stepStatus(step.result?.success)} | ${escapeTable(stepSummary(step.result))} |`)
  ];

  if (finalSuccess && !failedStep) {
    lines.splice(1, 0, "本轮已完成任务目标。模型在读取串口日志后应直接总结，不要继续重新决策。");
  }

  if (failedStep) {
    lines.push(
      "",
      "### 失败节点",
      `- 节点：${stepLabel(failedStep.name)}`,
      `- 原因：${stepSummary(failedStep.result)}`,
      ...stepEvidenceLines(failedStep.result)
    );
  } else if (skippedStep) {
    lines.push(
      "",
      "### 未继续执行的节点",
      `- 节点：${stepLabel(skippedStep.name)}`,
      `- 原因：${stepSummary(skippedStep.result)}`
    );
  }

  if (!steps.length) {
    lines.push("", "没有拿到工具步骤结果，需要检查后端工具返回结构。");
  }

  return lines.join("\n");
}

function describeFirmwareTask(description: string, task: string) {
  if (/呼吸灯|呼吸|breath|breathing|fade|fading/i.test(description)) return "GPIO PWM 呼吸灯，多个 GPIO 交替呼吸，速度按快-慢-快循环变化";
  if (/交替|轮流|alternate|alternating|blink|toggle/i.test(description)) return "GPIO 交替闪烁";
  if (/拉高|高电平|high/i.test(description) || /拉低|低电平|low/i.test(description)) return "GPIO 固定电平控制";
  if (task === "custom") return "自定义固件";
  return task;
}

function extractSteps(result: unknown) {
  if (!result || typeof result !== "object" || !("steps" in result)) return [];
  const steps = (result as { steps?: Array<{ name?: string; result?: unknown }> }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => ({
    name: String(step?.name || "unknown"),
    result: step?.result && typeof step.result === "object" ? step.result as Record<string, unknown> : {}
  }));
}

function stepResult(steps: Array<{ name: string; result: Record<string, unknown> }>, name: string) {
  return steps.find((step) => step.name === name)?.result || null;
}

function stepLabel(name: string) {
  const labels: Record<string, string> = {
    validate_gpio: "GPIO 校验",
    generate_firmware_task: "生成固件工程",
    compile: "PlatformIO 编译",
    flash: "烧录",
    monitor: "串口监控",
    task_observation_check: "任务运行观察"
  };
  return labels[name] || name;
}

function stepStatus(success: unknown) {
  if (success === true) return "成功";
  if (success === false) return "失败";
  if (success === null) return "跳过";
  return "未执行";
}

function stepSummary(result?: Record<string, unknown>) {
  if (!result) return "";
  if (typeof result.summary === "string" && result.summary.trim()) return result.summary.trim();
  if (typeof result.next_step === "string" && result.next_step.trim()) return result.next_step.trim();
  if (typeof result.message === "string" && result.message.trim()) return result.message.trim();
  if (typeof result.log === "string" && result.log.trim()) return firstMeaningfulLogLine(result.log);
  return "";
}

function stepEvidenceLines(result?: Record<string, unknown>) {
  const lines: string[] = [];
  if (!result) return lines;
  const diagnosis = result.diagnosis && typeof result.diagnosis === "object" ? result.diagnosis as Record<string, unknown> : null;
  if (diagnosis?.root_cause) lines.push(`- 诊断：${String(diagnosis.root_cause)}`);
  if (diagnosis?.next_step) lines.push(`- 下一步：${String(diagnosis.next_step)}`);
  if (typeof result.log === "string" && result.log.trim()) {
    lines.push("- 日志证据：");
    lines.push("```text");
    lines.push(firstLogBlock(result.log));
    lines.push("```");
  }
  return lines;
}

function firstMeaningfulLogLine(log: string) {
  return log.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function firstLogBlock(log: string) {
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-20).join("\n");
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 260);
}

function escapeCppString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r?\n/g, " ");
}



