import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import {
  checkEspTaskObservation,
  compileAndFlashGeneratedFirmware,
  diagnoseEspLog,
  listMergedEspSerialPorts,
  probeEspSerialPort,
  type EspFirmwareTaskRequest
} from "./espToolBridge.js";
import type { KnowledgeChunk } from "./knowledge/ragStore.js";

export interface LangChainEspAgentInput {
  message: string;
  log?: string;
  hardware?: Record<string, unknown>;
  history?: Array<{ role?: string; content?: string }>;
  hardwareStatus?: Record<string, unknown>;
  peripherals?: unknown[];
  knowledge?: KnowledgeChunk[];
  memory?: Record<string, unknown>;
  signal?: AbortSignal;
  llm?: {
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
  };
  progress?: (update: { stage: string; label: string; detail?: string; status?: "running" | "done" | "failed" | "stopped" }) => void;
}

export interface LangChainEspAgentResult {
  success: boolean;
  planner: {
    mode: string;
    intent: string;
    reason: string;
  };
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tool_calls: Array<Record<string, unknown>>;
  result: {
    success: boolean;
    summary: string;
    steps: unknown[];
    diagnosis?: unknown;
    task_acceptance?: unknown;
    knowledge_citations?: unknown;
    raw_agent_result?: unknown;
  };
}

const firmwareToolSchema = z.object({
  task_description: z.string().describe("User-facing ESP firmware task, in Chinese or English."),
  project_name: z.string().optional().describe("Short PlatformIO project name."),
  board_model: z.string().optional().describe("Human-readable ESP board model, such as esp32-s3-n16r8, luatos-esp32c3-core, or esp8266-nodemcuv2."),
  port: z.string().optional().describe("Serial port for upload, such as COM12. Leave empty to compile only."),
  main_cpp: z.string().optional().describe("Complete Arduino src/main.cpp code generated and controlled by the model. It may include agent_peripherals.h and call the provided helper functions."),
  sda_pin: z.number().int().optional(),
  scl_pin: z.number().int().optional(),
  oled_clk_pin: z.number().int().optional().describe("Dedicated SPI OLED CLK/SCK pin. Required when oled_protocol=spi."),
  oled_mosi_pin: z.number().int().optional().describe("Dedicated SPI OLED MOSI/DIN pin. Required when oled_protocol=spi."),
  led_pin: z.number().int().optional(),
  buzzer_pin: z.number().int().optional(),
  oled_reset_pin: z.number().int().optional(),
  oled_dc_pin: z.number().int().optional(),
  oled_protocol: z.enum(["auto", "i2c", "spi"]).optional().describe("OLED bus protocol. Use spi for 6-pin OLED modules with SCL/SDA/RES/DC."),
  compile_timeout_sec: z.number().int().optional().describe("PlatformIO compile timeout in seconds."),
  upload_timeout_sec: z.number().int().optional().describe("PlatformIO upload timeout in seconds."),
  monitor_seconds: z.number().optional().describe("Serial monitor capture duration in seconds.")
});

const diagnoseLogSchema = z.object({
  log: z.string().describe("Build, upload, serial, or pasted hardware log to diagnose.")
});

const probeSerialSchema = z.object({
  port: z.string().describe("Serial port name, such as COM12."),
  baud: z.number().int().optional().describe("Serial baud rate. Default 115200.")
});

export async function runLangChainEspAgent(input: LangChainEspAgentInput): Promise<LangChainEspAgentResult | null> {
  const config = resolveLangChainConfig(input.llm);
  if (!config.enabled || !config.apiKey || !config.baseUrl || !config.model) return null;

  const toolCalls: Array<Record<string, unknown>> = [];
  const hardware = input.hardware || {};
  const history = normalizeHistory(input.history);
  const knowledge = (input.knowledge || []).slice(0, 4).map((hit) => ({
    title: hit.title,
    filename: hit.filename,
    chunk_index: hit.chunk_index,
    source: hit.source,
    text: hit.text.length > 700 ? `${hit.text.slice(0, 700)}...` : hit.text
  }));

  const compileAndFlashTool = tool(
    async (args) => {
      input.progress?.({
        stage: "main_cpp_generation",
        label: "模型编写 main.cpp",
        detail: "模型已在 ReAct 决策中选择执行固件任务，并提交 main.cpp；正在校验源码完整性。",
        status: "running"
      });
      const mainCppValidation = normalizeModelMainCpp(args.main_cpp);
      if (!mainCppValidation.success) {
        const result = {
          success: false,
          failed_node: "main_cpp_validation",
          summary: "main_cpp 缺失或不完整，本次没有生成兜底模板，也没有编译烧录。请模型补全完整 Arduino main.cpp 后重新调用工具。",
          reason: mainCppValidation.reason,
          required: ["#include <Arduino.h>", "void setup()", "void loop()"],
          received_preview: mainCppValidation.preview
        };
        toolCalls.push(toolCall("compile_and_flash_generated_firmware", { task_description: args.task_description, main_cpp_validation: false }, result));
        input.progress?.({
          stage: "react_loop",
          label: "ReAct 修正中",
          detail: "main.cpp 校验未通过，已作为 Observation 返回给模型；模型将自主决定补全代码后重试，或说明无法继续的原因。",
          status: "running"
        });
        return JSON.stringify(result);
      }
      const mainCpp = mainCppValidation.code;
      input.progress?.({
        stage: "firmware_tool",
        label: "工具执行",
        detail: "main.cpp 校验通过，正在生成 PlatformIO 工程、编译、烧录并读取串口日志。",
        status: "running"
      });
      const payload: EspFirmwareTaskRequest = {
        project_name: String(args.project_name || hardware.project_name || "esp_agent_generated_firmware"),
        board_model: String(args.board_model || hardware.board_model || "auto"),
        board: String(hardware.board || ""),
        port: String(args.port || hardware.port || "").trim() || undefined,
        flash_size: String(hardware.flash_size || ""),
        memory_type: String(hardware.memory_type || ""),
        partitions: String(hardware.partitions || ""),
        sda_pin: toInt(args.sda_pin ?? hardware.sda_pin, -1),
        scl_pin: toInt(args.scl_pin ?? hardware.scl_pin, -1),
        oled_clk_pin: toInt(args.oled_clk_pin ?? hardware.oled_clk_pin, -1),
        oled_mosi_pin: toInt(args.oled_mosi_pin ?? hardware.oled_mosi_pin, -1),
        led_pin: toOptionalPin(args.led_pin ?? hardware.led_pin),
        buzzer_pin: toOptionalPin(args.buzzer_pin ?? hardware.buzzer_pin),
        oled_reset_pin: toInt(args.oled_reset_pin ?? hardware.oled_reset_pin, -1),
        oled_dc_pin: toInt(args.oled_dc_pin ?? hardware.oled_dc_pin, -1),
        oled_protocol: String(args.oled_protocol || hardware.oled_protocol || "auto"),
        task_description: args.task_description,
        task: "custom",
        custom_code: mainCpp,
        oled_text: String(hardware.oled_text || input.message || ""),
        compile_timeout_sec: clampNumber(args.compile_timeout_sec ?? config.compileTimeoutSec, 60, 1800, 600),
        upload_timeout_sec: clampNumber(args.upload_timeout_sec ?? config.uploadTimeoutSec, 30, 600, 180),
        monitor_seconds: clampNumber(args.monitor_seconds ?? config.monitorSeconds, 1, 120, 8)
      };
      const result = await compileAndFlashGeneratedFirmware(payload, input.signal);
      toolCalls.push(toolCall("compile_and_flash_generated_firmware", payload, result));
      input.progress?.({
        stage: "serial_observation",
        label: "串口观测",
        detail: `工具已返回编译/烧录/串口结果：${summarizeToolOutcome(result)}，正在交给模型判断是否需要继续修正。`,
        status: "running"
      });
      input.progress?.({
        stage: "finalizing",
        label: "模型验收与总结",
        detail: "模型正在根据任务目标、工具结果、串口日志和硬件证据判断是否成功，或是否回到 ReAct 决策继续修正。",
        status: "running"
      });
      return JSON.stringify(compactToolResult(result));
    },
    {
      name: "compile_and_flash_generated_firmware",
      description: [
        "Create a PlatformIO ESP firmware project, compile it, flash it when a serial port is available, then optionally read serial logs and run task-specific observation checks.",
        "Use this only when the current user message explicitly asks to execute hardware behavior, generate firmware, compile, flash, upload, run, verify, test, control GPIO/LED/buzzer/OLED/AHT20, or read sensors.",
        "Do not use this for information-only questions about pin wiring, current configuration, differences, causes, principles, documentation, or explanations. Answer those directly without compiling or flashing.",
        "The model should normally provide a complete main_cpp as the application controller.",
        "The generated project always includes src/agent_peripherals.h and src/agent_peripherals.cpp as an optional helper library.",
        "Available helper APIs: agentInit(), agentHeartbeat(), i2cInit(), oledInit(), oledShowChinese(line1,line2,line3), ledInit(), ledSet(on), ledBlink(periodMs,count), buzzerInit(), buzzerBeep(freq,durationMs), buzzerHappyBirthday(), aht20Init(), aht20Read(&temperature,&humidity).",
        "agentInit() is core-only: it logs the configured pins but does not initialize OLED, AHT20, LED, buzzer, or I2C. Peripheral functions lazily initialize only the peripheral they use.",
        "Only pass led_pin or buzzer_pin when the current user task actually uses LED or buzzer. For OLED-only tasks, leave LED and buzzer disabled as -1.",
        "For a 6-pin SPI OLED with VCC/GND plus four signal pins SCL/CLK, SDA/MOSI, RES, DC, set oled_protocol=spi and explicitly pass oled_clk_pin, oled_mosi_pin, oled_reset_pin, and oled_dc_pin. Do not rely on I2C SDA/SCL fallback for SPI OLED. There is no CS pin on this module, so CS is U8X8_PIN_NONE.",
        "Only omit main_cpp when the user is not asking for firmware generation or when a safe fallback app is acceptable.",
        "For a concrete firmware task, do not silently rely on a generated fallback template. If you intend custom behavior, pass the complete source in main_cpp.",
        "main_cpp must exactly contain all three required elements: #include <Arduino.h>, void setup(), and void loop(). If any one is missing, the tool call must fail at main_cpp_validation and must not fall back to a template.",
        "After tool execution, verify firmware_source, custom_code, main_cpp_hash, and main_cpp_preview. If they do not match the intended firmware, report firmware generation failure instead of diagnosing hardware.",
        "If the task names a specific display controller such as SH1106, do not use the SSD1306 helper path; write a driver-specific main_cpp or use a matching helper."
      ].join(" "),
      schema: firmwareToolSchema
    }
  );

  const diagnoseTool = tool(
    async ({ log }) => {
      input.progress?.({
        stage: "diagnose_log",
        label: "日志诊断",
        detail: "正在分析编译、烧录或串口日志。",
        status: "running"
      });
      const diagnosis = await diagnoseEspLog(log);
      const observation = await checkEspTaskObservation(log);
      const result = { diagnosis, observation };
      input.progress?.({
        stage: "diagnose_log",
        label: "日志诊断完成",
        detail: summarizeToolOutcome(result),
        status: "done"
      });
      toolCalls.push(toolCall("diagnose_esp_log", { log_chars: log.length }, result));
      return JSON.stringify(compactToolResult(result));
    },
    {
      name: "diagnose_esp_log",
      description: "Diagnose ESP build, upload, serial, I2C, brownout, watchdog, OLED, AHT20, LED, or buzzer logs.",
      schema: diagnoseLogSchema
    }
  );

  const listPortsTool = tool(
    async () => {
      input.progress?.({
        stage: "list_ports",
        label: "扫描串口",
        detail: "正在检测当前可用 USB-UART/串口。",
        status: "running"
      });
      const result = await listMergedEspSerialPorts();
      input.progress?.({
        stage: "list_ports",
        label: "串口扫描完成",
        detail: summarizeToolOutcome(result),
        status: extractToolSuccess(result) === false ? "failed" : "done"
      });
      toolCalls.push(toolCall("list_serial_ports", {}, result));
      return JSON.stringify(compactToolResult(result));
    },
    {
      name: "list_serial_ports",
      description: "List available serial ports and USB-UART candidates for ESP upload and serial monitoring.",
      schema: z.object({})
    }
  );

  const probeSerialTool = tool(
    async ({ port, baud }) => {
      input.progress?.({
        stage: "probe_serial",
        label: "探测串口",
        detail: `正在打开 ${port} 验证串口可用性。`,
        status: "running"
      });
      const result = await probeEspSerialPort(port, baud || 115200);
      input.progress?.({
        stage: "probe_serial",
        label: "串口探测完成",
        detail: summarizeToolOutcome(result),
        status: extractToolSuccess(result) === false ? "failed" : "done"
      });
      toolCalls.push(toolCall("probe_serial_port", { port, baud: baud || 115200 }, result));
      return JSON.stringify(compactToolResult(result));
    },
    {
      name: "probe_serial_port",
      description: "Open a serial port briefly to verify whether it can be used for ESP flashing or monitoring.",
      schema: probeSerialSchema
    }
  );

  const model = new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    temperature: 0.2,
    timeout: config.modelTimeoutMs,
    configuration: {
      baseURL: config.baseUrl
    }
  });

  const agent = createAgent({
    model,
    tools: [compileAndFlashTool, diagnoseTool, listPortsTool, probeSerialTool],
    systemPrompt: espSystemPrompt()
  });

  input.progress?.({
    stage: "react_loop",
    label: "ReAct 推理",
    detail: "模型正在基于任务、硬件配置、记忆和知识库规划下一步：编写 main.cpp、调用工具、分析 Observation 或直接回复。",
    status: "running"
  });
  let agentResult: unknown = null;
  let reply = "";
  try {
    agentResult = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              task: input.message,
              pasted_log: input.log || "",
              hardware,
              recent_history: history.slice(-8),
              hardware_status: input.hardwareStatus || {},
              peripherals: input.peripherals || [],
              knowledge_hits: knowledge,
              memory_context: input.memory || {}
            })
          }
        ]
      },
      { signal: input.signal, recursionLimit: config.recursionLimit }
    );
    reply = extractAgentReply(agentResult) || "";
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw error;
  }

  if (!reply) {
    throw new Error("模型没有返回最终回复，请检查模型服务状态或提高模型超时时间。");
  }
  const hasFailedTool = toolCalls.some((call) => extractToolSuccess((call as Record<string, unknown>).output) === false);
  input.progress?.({
    stage: "acceptance",
    label: "任务验收",
    detail: "正在根据模型最终回复、工具调用、串口日志和硬件证据生成本轮任务验收结论。",
    status: "running"
  });
  const taskAcceptance = await judgeTaskAcceptance({
    message: input.message,
    hardware,
    peripherals: input.peripherals || [],
    toolCalls,
    assistantReply: reply,
    knowledge,
    config,
    signal: input.signal
  });
  const taskSuccess = taskAcceptance.task_success ?? !hasFailedTool;
  input.progress?.({
    stage: "completed",
    label: "返回结果",
    detail: taskAcceptance.verdict || (toolCalls.length ? `已完成 ${toolCalls.length} 次工具调用。` : "模型直接完成回答，未调用工具。"),
    status: "done"
  });
  return {
    success: true,
    planner: {
      mode: `langchain:${config.provider}`,
      intent: toolCalls.length ? "tool_loop" : "chat_only",
      reason: "LangChain Agent executed ReAct-style reasoning, selected ESP tools, and observed tool results."
    },
    messages: [
      { role: "user", content: input.message || "(empty task)" },
      { role: "assistant", content: reply }
    ],
    tool_calls: toolCalls,
    result: {
      success: taskSuccess,
      summary: reply,
      steps: toolCalls,
      task_acceptance: taskAcceptance,
      knowledge_citations: knowledge,
      raw_agent_result: compactToolResult(agentResult)
    }
  };
}

function extractToolSuccess(result: unknown) {
  if (result && typeof result === "object" && "success" in result) return Boolean((result as { success?: unknown }).success);
  return true;
}

function summarizeToolOutcome(result: unknown) {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.summary === "string" && record.summary) return record.summary;
    if (Array.isArray(record.steps)) return `工具返回 ${record.steps.length} 个步骤。`;
  }
  return "工具已返回结果。";
}

async function judgeTaskAcceptance(input: {
  message: string;
  hardware: Record<string, unknown>;
  peripherals: unknown[];
  toolCalls: Array<Record<string, unknown>>;
  assistantReply: string;
  knowledge: unknown[];
  config: ReturnType<typeof resolveLangChainConfig>;
  signal?: AbortSignal;
}) {
  const hasFailedTool = input.toolCalls.some((call) => extractToolSuccess(call.output) === false);
  if (!input.config.enabled || !input.config.apiKey || !input.config.baseUrl || !input.config.model) {
    return {
      task_success: !hasFailedTool,
      verdict: hasFailedTool ? "模型验收不可用，按工具状态兜底为未通过。" : "模型验收不可用，按工具状态兜底为通过。",
      evidence: [],
      failed_node: hasFailedTool ? findFailedToolName(input.toolCalls) : "",
      next_step: hasFailedTool ? "补充串口日志或实际硬件现象后重新验收。" : "如硬件现象符合任务，可视为完成。",
      judged_by: "tool_status_fallback"
    };
  }
  try {
    const response = await fetch(`${input.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.config.apiKey}`
      },
      body: JSON.stringify({
        model: input.config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: [
              "你是 Embex 的任务验收裁判。",
              "只判断用户本轮具体任务是否完成，不要机械等同于某个工具 success 字段。",
              "综合用户任务、外设配置、工具调用结果、编译/烧录/串口日志、assistant 回复和实际证据。",
              "工具或步骤的 success=false 只是观察项，不等于任务失败；编译、烧录、串口监控、诊断、报告生成等节点要分别判断是否影响本轮用户目标。",
              "如果工具返回了失败字段，但串口日志、工具输出或用户反馈已经证明硬件功能满足本轮任务，必须判定 task_success=true，并说明该失败节点为什么不影响最终功能。",
              "如果硬件已经按用户要求实现功能，最终验收应以具体任务达成为准，而不是以某个工具节点状态为准。",
              "如果缺少关键证据，不要盲目判成功；应指出缺少的证据和需要补充的观察。",
              "只输出严格 JSON：task_success(boolean), verdict(string), evidence(string[]), failed_node(string), next_step(string), confidence(number)。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({
              task: input.message,
              hardware: input.hardware,
              peripherals: input.peripherals,
              assistant_reply: input.assistantReply,
              tool_calls: input.toolCalls.map((call) => ({
                name: call.name,
                input: compactToolResult(call.input),
                output: compactToolResult(call.output)
              })),
              knowledge: input.knowledge
            })
          }
        ]
      }),
      signal: input.signal
    });
    if (!response.ok) throw new Error(`acceptance_http_${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = parseJsonObject(data.choices?.[0]?.message?.content?.trim() || "");
    if (!parsed) throw new Error("acceptance_json_parse_failed");
    return {
      task_success: Boolean(parsed.task_success),
      verdict: String(parsed.verdict || ""),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
      failed_node: String(parsed.failed_node || ""),
      next_step: String(parsed.next_step || ""),
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : undefined,
      judged_by: "model_task_acceptance"
    };
  } catch (error) {
    return {
      task_success: !hasFailedTool,
      verdict: `模型验收失败，按工具状态兜底：${error instanceof Error ? error.message : String(error)}`,
      evidence: [],
      failed_node: hasFailedTool ? findFailedToolName(input.toolCalls) : "",
      next_step: hasFailedTool ? "补充串口日志或实际硬件现象后重新验收。" : "如硬件现象符合任务，可视为完成。",
      judged_by: "acceptance_fallback"
    };
  }
}

function findFailedToolName(toolCalls: Array<Record<string, unknown>>) {
  const failed = toolCalls.find((call) => extractToolSuccess(call.output) === false);
  return failed ? String(failed.name || "unknown_tool") : "";
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

function resolveLangChainConfig(config: LangChainEspAgentInput["llm"]) {
  return {
    enabled: Boolean(config?.enabled ?? process.env.LLM_ENABLED === "true"),
    provider: String(config?.provider || process.env.LLM_PROVIDER || "openai-compatible"),
    baseUrl: String(config?.baseUrl || process.env.LLM_BASE_URL || ""),
    apiKey: String(config?.apiKey || process.env.LLM_API_KEY || ""),
    model: String(config?.model || process.env.LLM_MODEL || ""),
    modelTimeoutMs: clampNumber(config?.modelTimeoutMs ?? process.env.CHIPWIZ_MODEL_TIMEOUT_MS, 30_000, 600_000, 600_000),
    recursionLimit: clampNumber(config?.recursionLimit ?? process.env.CHIPWIZ_REACT_RECURSION_LIMIT, 1, 20, 8),
    compileTimeoutSec: clampNumber(config?.compileTimeoutSec ?? process.env.CHIPWIZ_COMPILE_TIMEOUT_SEC, 60, 1800, 600),
    uploadTimeoutSec: clampNumber(config?.uploadTimeoutSec ?? process.env.CHIPWIZ_UPLOAD_TIMEOUT_SEC, 30, 600, 180),
    monitorSeconds: clampNumber(config?.monitorSeconds ?? process.env.CHIPWIZ_MONITOR_SECONDS, 1, 120, 8)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function espSystemPrompt() {
  return [
    "你是 Embex，面向 ESP 系列开发板的全流程编译调试智能体，目标硬件包括 ESP32、ESP32-S3、ESP32-C3、ESP8266 及用户指定的兼容开发板。",
    "核心工作方式是 ReAct：先分析当前用户消息、硬件状态、历史上下文和约束；只有需要真实执行时才调用工具；读取 Observation 后再总结、修复或停止。",
    "最重要的工具边界：当前用户消息如果只是问接线、引脚连接、当前配置、型号区别、原因、原理、流程、解释、是否可行、怎么接、是什么、为什么，必须直接回答，禁止调用编译、烧录、串口监控或固件生成工具。",
    "只有当前用户消息明确要求执行动作时，才允许调用工具。明确动作包括：执行、运行、跑一下、烧录、上传、编译、生成固件、测试一下、验证一下、让 OLED 显示、OLED 显示、显示到 OLED、屏幕显示、点亮、熄灭、拉高、拉低、闪烁、控制、读取传感器、播放蜂鸣器。",
    "例如“OLED 显示你好”“屏幕显示温度”“显示到 OLED 上”都属于明确硬件执行任务，必须生成 main.cpp 并调用 compile_and_flash_generated_firmware，而不是普通问答。",
    "历史对话和 hardware_status 只能用于补全板卡、端口、引脚和外设配置，不能单独把一个信息查询问题升级成工具执行任务。",
    "knowledge_hits 是本地 RAG 知识库检索片段。回答、诊断或生成代码前应优先参考这些资料；最终回答要简要列出使用的知识来源文件和 chunk。",
    "memory_context 是 Embex 长期记忆，包含长期摘要、短期上下文、硬件状态、项目事实、用户偏好和历史失败案例。它只能用于保持上下文连续、补全已确认配置、避免重复踩坑；不能把一个信息查询问题升级成工具执行任务。",
    "如果 memory_context 与当前用户消息冲突，以当前用户消息为准；如果 memory_context 只保存了某个外设引脚，不代表当前任务一定要使用该外设。",
    "如果用户意图不明确，先追问：你是想让我解释当前配置，还是直接烧录一个验证固件？不要擅自烧录。",
    "当且仅当需要固件任务时，优先生成完整 Arduino src/main.cpp，并调用 compile_and_flash_generated_firmware。模型拥有 main.cpp 主控权，src/agent_peripherals.h/cpp 只是可选辅助函数库。",
    "具体固件任务禁止静默回退到默认模板。必须把完整 Arduino 源码放入 main_cpp；如果 main_cpp 缺失、不完整、被拒绝或没有作为工具参数传入，报告 main_cpp_validation 失败，不要假装已经生成了目标固件。",
    "main.cpp 必须至少包含 #include <Arduino.h>、void setup()、void loop()，并建议输出 [BOOT]、[APP]、[OLED]、[LED]、[BUZZER]、[AHT20] 等串口证据。",
    "工具返回后必须核对 firmware_source、custom_code、main_cpp_hash、main_cpp_preview，确认实际编译烧录的代码就是模型意图；如果不一致，报告固件生成失败，不要误判为硬件问题。",
    "可用辅助 API：agentInit(), agentHeartbeat(), i2cInit(), oledInit(), oledShowChinese(line1,line2,line3), ledInit(), ledSet(on), ledBlink(periodMs,count), buzzerInit(), buzzerBeep(freq,durationMs), buzzerHappyBirthday(), aht20Init(), aht20Read(&temperature,&humidity)。",
    "agentInit() 只做 core 初始化和引脚日志，不初始化 OLED、AHT20、LED、蜂鸣器或 I2C；各外设函数按需懒初始化。",
    "6pin SPI OLED 指 VCC/GND 加 SCL/CLK、SDA/MOSI、RES、DC。执行 OLED 固件任务时设置 oled_protocol=spi，并显式传 oled_clk_pin、oled_mosi_pin、oled_reset_pin、oled_dc_pin；没有 CS，代码使用 U8X8_PIN_NONE。",
    "OLED 中文显示优先调用 oledShowChinese；如自行写驱动，使用 U8g2、u8g2_font_wqy12_t_gb2312、drawUTF8。不要用 Adafruit_GFX 默认字库显示中文。",
    "如果用户明确指定 OLED 控制器型号如 SH1106，不要走 SSD1306 helper 路径；生成对应控制器的完整 main.cpp，或说明当前 helper 不支持该控制器。",
    "只在当前任务明确使用 LED 或蜂鸣器时传 led_pin 或 buzzer_pin；OLED-only 任务禁用无关外设。",
    "缺少串口但任务需要烧录时，先调用 list_serial_ports；需要确认端口可用时调用 probe_serial_port。",
    "工具调用后根据真实返回结果总结，不输出固定套话。若编译、烧录、串口监控和 task_observation_check 已证明任务完成，立即停止继续调用工具并总结。",
    "若某一步失败，指出失败节点、原因、日志证据和下一步建议；不要重新决策成无关任务，不要要求当前任务未使用外设的证据。",
    "成功判断必须基于当前任务目标：GPIO/LED 看日志并提示物理观察或测量；OLED 看 [OLED] 日志和用户观察；AHT20 看温湿度日志；蜂鸣器看日志和用户听感。",
    "回答中明确说明是否调用工具；未调用工具时直接说明这是信息查询，因此没有编译烧录。",
    "不要提上游仓库、历史实现或迁移来源。"
  ].join("\n");
}

function compactToolResult(value: unknown): unknown {
  const stepSummary = summarizeStepResult(value);
  if (stepSummary) return stepSummary;
  if (typeof value !== "object" || value === null) return value;
  const text = JSON.stringify(value);
  if (text.length <= 8000) return value;
  return {
    truncated: true,
    chars: text.length,
    preview: text.slice(0, 4000)
  };
}

function summarizeStepResult(value: unknown) {
  if (!value || typeof value !== "object" || !("steps" in value)) return null;
  const result = value as {
    success?: unknown;
    summary?: unknown;
    diagnosis?: unknown;
    steps?: Array<{ name?: string; result?: Record<string, unknown> }>;
  };
  if (!Array.isArray(result.steps)) return null;
  return {
    success: Boolean(result.success),
    summary: String(result.summary || ""),
    diagnosis: result.diagnosis,
    steps: result.steps.map((step) => {
      const stepResult = step.result || {};
      const log = String(stepResult.log || "");
      return {
        name: step.name,
        success: stepResult.success,
        summary: stepResult.summary || stepResult.next_step || "",
        command: stepResult.command || "",
        project_dir: stepResult.project_dir || "",
        log_tail: log ? tailLines(log, 30) : "",
        diagnosis: stepResult.diagnosis || undefined,
        observation: stepResult.checks ? {
          passed: stepResult.passed,
          total: stepResult.total,
          missing: stepResult.missing
        } : undefined
      };
    })
  };
}

function tailLines(value: string, count: number) {
  const lines = value.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

function extractAgentReply(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const candidate = result as {
    content?: unknown;
    messages?: Array<{ content?: unknown }>;
  };
  if (typeof candidate.content === "string") return candidate.content.trim();
  const last = Array.isArray(candidate.messages) ? candidate.messages.at(-1) : undefined;
  if (typeof last?.content === "string") return last.content.trim();
  if (Array.isArray(last?.content)) return JSON.stringify(last.content);
  return "";
}

function toolCall(name: string, input: unknown, output: unknown) {
  return {
    name,
    input,
    output,
    timestamp: new Date().toISOString()
  };
}

function toInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toOptionalPin(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return -1;
  return toInt(value, -1);
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

function normalizeModelMainCpp(value: unknown) {
  let code = String(value || "").trim();
  if (!code) {
    return {
      success: false,
      code: "",
      reason: "main_cpp is empty or was not passed as a tool argument.",
      preview: ""
    };
  }
  const fenced = code.match(/```(?:cpp|c\+\+|arduino|c)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) code = fenced[1].trim();
  const missing = [];
  if (!code.includes("#include <Arduino.h>")) missing.push("#include <Arduino.h>");
  if (!/\bvoid\s+setup\s*\(/.test(code)) missing.push("void setup()");
  if (!/\bvoid\s+loop\s*\(/.test(code)) missing.push("void loop()");
  if (missing.length > 0) {
    return {
      success: false,
      code: "",
      reason: `main_cpp is missing required element(s): ${missing.join(", ")}.`,
      preview: code.split(/\r?\n/).slice(0, 12).join("\n")
    };
  }
  return {
    success: true,
    code,
    reason: "",
    preview: code.split(/\r?\n/).slice(0, 12).join("\n")
  };
}
