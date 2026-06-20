import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Cable,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  HardDrive,
  Loader2,
  MessageSquare,
  Play,
  RefreshCcw,
  Settings,
  Terminal,
  Trash2,
  TriangleAlert
} from "lucide-react";
import "./styles.css";

interface KnowledgeDocument {
  id: string;
  filename: string;
  title: string;
  type: string;
  source: string;
  tags: string[];
  uploaded_at: string;
  indexed_at: string;
  status: "indexed" | "failed";
  chunks: number;
  size: number;
}

interface KnowledgeHit {
  id: string;
  document_id: string;
  filename: string;
  title: string;
  chunk_index: number;
  text: string;
  tags: string[];
  source: string;
  score: number;
  match_terms?: string[];
}

interface ClosedLoopStep {
  name: string;
  result: {
    success?: boolean | null;
    summary?: string;
    command?: string;
    findings?: Array<{ kind?: string; severity?: string; role?: string; gpio?: string; message?: string }>;
    log?: string;
    project_dir?: string;
    next_step?: string;
    diagnosis?: Diagnosis;
    passed?: number;
    total?: number;
    checks?: ObservationCheckItem[];
    missing?: ObservationCheckItem[];
  };
}

interface ObservationCheckItem {
  key: string;
  label: string;
  passed: boolean;
  evidence_required: string;
  action: string;
}

interface Diagnosis {
  root_cause: string;
  confidence: number;
  next_step: string;
  findings: Array<{
    kind: string;
    severity: "info" | "warning" | "critical";
    evidence: string;
    action: string;
  }>;
}

interface ClosedLoopResult {
  success: boolean;
  summary: string;
  steps: ClosedLoopStep[];
  diagnosis: Diagnosis;
  task_acceptance?: Record<string, unknown>;
}

interface SerialPortInfo {
  device: string;
  description?: string;
  hwid?: string;
  manufacturer?: string;
  is_usb_candidate?: boolean;
  is_bluetooth?: boolean;
  source?: string;
  pnp_status?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolCallView {
  name?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  result?: unknown;
}

interface KnowledgeCitationView {
  id?: string;
  document_id?: string;
  filename?: string;
  title?: string;
  chunk_index?: number;
  source?: string;
  score?: number;
  text?: string;
}

interface ToolCallSummaryItem {
  label: string;
  value: string;
}

interface MemoryConversationMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  created_at?: string;
}

interface MemoryTurnView {
  id: string;
  created_at: string;
  messages: MemoryConversationMessage[];
  hardware_state?: Record<string, unknown>;
  project_state?: Record<string, unknown>;
  tags?: string[];
}

interface MemoryStateView {
  version: number;
  short_term_context: MemoryConversationMessage[];
  long_term_summary: string;
  hardware_state: Record<string, unknown>;
  project_state: Record<string, unknown>;
  project_facts: string[];
  user_preferences: string[];
  failure_cases: Array<Record<string, unknown>>;
  updated_at: string;
  notes: string[];
}

interface MemoryApiState {
  success?: boolean;
  state: MemoryStateView;
  recent_turns: MemoryTurnView[];
  project_facts?: {
    facts?: string[];
    updated_at?: string;
  };
}

interface CapabilityDefinition {
  name: string;
  title: string;
  enabled: boolean;
  description: string;
  inputs?: string[];
  outputs?: string[];
  capabilities?: string[];
  stage: string;
  category?: string;
  invocation?: string;
  examples?: string[];
}

interface AgentChatResult {
  success?: boolean;
  planner?: {
    mode?: string;
    intent?: string;
    reason?: string;
  };
  messages?: ChatMessage[];
  tool_calls?: ToolCallView[];
  result?: ClosedLoopResult;
  message?: string;
  summary?: string;
}

interface LlmSettings {
  enabled: boolean;
  mode: "chat_only" | "auto";
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  modelTimeoutMs: number;
  recursionLimit: number;
  compileTimeoutSec: number;
  uploadTimeoutSec: number;
  monitorSeconds: number;
}

interface ConversationTurn {
  id: string;
  user: string;
  assistant: string;
  planner?: AgentChatResult["planner"];
  toolCalls: ToolCallView[];
  result?: ClosedLoopResult;
  progress?: ChatProgress;
}

interface ActiveChatRequest {
  requestId: string;
  turnId: string;
  startedAt: string;
}

interface ChatProgress {
  stage: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt?: string;
  updatedAt?: string;
  finalResult?: AgentChatResult;
  finalError?: string;
  flow?: "chat" | "capability" | "diagnosis" | "firmware";
}

interface ChatStatusResponse {
  status?: ChatProgress;
}

interface HardwareStatusSnapshot {
  form: ConsoleForm;
  hardwareChecks: HardwareChecks;
  peripherals: PeripheralConfig[];
  boardPinMap: BoardPinMap;
  selectedPort: string;
  readyForCompile: boolean;
  readyForUpload: boolean;
  availablePorts: string[];
  portsMessage: string;
  probeResult: Record<string, unknown> | null;
  updatedAt: string;
}

interface PeripheralTemplate {
  id: string;
  name: string;
  bus: "gpio" | "i2c" | "pwm" | "uart" | "adc" | "spi";
  pins: Array<{ key: string; label: string; defaultValue: number; hint: string }>;
}

interface PeripheralConfig {
  id: string;
  templateId: string;
  name: string;
  enabled: boolean;
  pins: Record<string, number>;
  notes: string;
}

interface BoardPinMap {
  boardModel: string;
  title: string;
  displayName?: string;
  family?: string;
  platformioBoard?: string;
  aliasOf?: string;
  pins?: BoardPinDefinition[];
  safePins: string[];
  avoidPins: string[];
  defaults: Record<string, number>;
  notes: string[];
  imageUrl?: string;
  sourceUrl?: string;
}

interface BoardPinDefinition {
  label: string;
  functions: string[];
  status?: "safe" | "avoid" | "default";
  role?: string;
}

interface BoardKnowledge {
  boards: BoardPinMap[];
  updated_at?: string;
  purpose?: string;
  usage_for_agent?: string;
}

interface PreflightResult {
  ready_for_compile?: boolean;
  ready_for_upload?: boolean;
  next_step?: string;
  openable_pnp_ports?: string[];
  windows_pnp_usb_uart_candidates?: unknown[];
  windows_pnp_serial_probe_results?: Array<{
    port?: string;
    success?: boolean;
    message?: string;
    error_type?: string;
  }>;
  selftest?: {
    success: boolean;
    cases: Array<{ case_id: string; ok: boolean }>;
  };
}

const defaults = {
  project_name: "embex_task",
  board_model: "luatos-esp32c3-core",
  board: "",
  port: "",
  flash_size: "",
  memory_type: "",
  partitions: "",
  sda_pin: -1,
  scl_pin: -1,
  oled_clk_pin: -1,
  oled_mosi_pin: -1,
  oled_reset_pin: -1,
  oled_dc_pin: -1,
  oled_protocol: "spi" as "auto" | "i2c" | "spi",
  led_pin: -1,
  buzzer_pin: -1
};

const hardwareCheckDefaults = {
  i2cSharedBus: false,
  outputGpios: false,
  oledPower: false,
  commonGround: false
};

const peripheralTemplates: PeripheralTemplate[] = [
  {
    id: "oled_spi_6pin",
    name: "6pin SPI OLED",
    bus: "spi",
    pins: [
      { key: "clk", label: "SCL/CLK", defaultValue: -1, hint: "接 OLED SCL/CLK/SCK" },
      { key: "mosi", label: "SDA/MOSI", defaultValue: -1, hint: "接 OLED SDA/DIN/MOSI" },
      { key: "res", label: "RES/RST", defaultValue: -1, hint: "接 OLED RES/RST" },
      { key: "dc", label: "DC", defaultValue: -1, hint: "接 OLED DC" }
    ]
  },
  {
    id: "oled_i2c_4pin",
    name: "4pin I2C OLED",
    bus: "i2c",
    pins: [
      { key: "sda", label: "SDA", defaultValue: 4, hint: "接 OLED SDA" },
      { key: "scl", label: "SCL", defaultValue: 5, hint: "接 OLED SCL" },
      { key: "res", label: "RES/RST", defaultValue: -1, hint: "-1 表示固定拉高或不用 GPIO" }
    ]
  },
  {
    id: "aht20_i2c",
    name: "AHT20 温湿度",
    bus: "i2c",
    pins: [
      { key: "sda", label: "SDA", defaultValue: 4, hint: "可与 OLED 共用 SDA" },
      { key: "scl", label: "SCL", defaultValue: 5, hint: "可与 OLED 共用 SCL" }
    ]
  },
  {
    id: "led_gpio",
    name: "外接 LED",
    bus: "gpio",
    pins: [
      { key: "signal", label: "控制 GPIO", defaultValue: 12, hint: "串联限流电阻或接驱动输入" }
    ]
  },
  {
    id: "passive_buzzer",
    name: "无源蜂鸣器（三极管驱动）",
    bus: "pwm",
    pins: [
      { key: "signal", label: "PWM GPIO", defaultValue: 18, hint: "接三极管基极限流电阻输入" }
    ]
  },
  {
    id: "bh1750_i2c",
    name: "BH1750 光照",
    bus: "i2c",
    pins: [
      { key: "sda", label: "SDA", defaultValue: 4, hint: "I2C SDA，可按实际总线选择" },
      { key: "scl", label: "SCL", defaultValue: 5, hint: "I2C SCL，可按实际总线选择" }
    ]
  },
  {
    id: "generic_gpio",
    name: "通用 GPIO 外设",
    bus: "gpio",
    pins: [
      { key: "signal", label: "信号 GPIO", defaultValue: 12, hint: "按实际外设连接" }
    ]
  }
];

const storageKey = "yd-agent-console-state-v1";
const llmStorageKey = "yd-agent-llm-settings-v1";
const conversationStorageKey = "yd-agent-conversation-v1";
const hardwareStatusStorageKey = "yd-agent-hardware-status-v1";
const activeChatRequestStorageKey = "embex-active-chat-request-v1";
const legacyActiveChatRequestStorageKey = "chipwiz-active-chat-request-v1";
const activeChatRequestStaleMs = 30 * 60_000;

type ConsoleForm = typeof defaults;
type HardwareChecks = typeof hardwareCheckDefaults;
type SidebarView = "chat" | "model" | "hardware" | "knowledge" | "memory" | "reports";

function App() {
  const [form, setForm] = useState<ConsoleForm>(() => loadSavedState().form);
  const [hardwareChecks, setHardwareChecks] = useState<HardwareChecks>(() => loadSavedState().hardwareChecks);
  const [peripherals, setPeripherals] = useState<PeripheralConfig[]>(() => loadSavedState().peripherals);
  const [result, setResult] = useState<ClosedLoopResult | null>(null);
  const [environment, setEnvironment] = useState<Record<string, unknown> | null>(null);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [manualLog, setManualLog] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>(() => loadConversationTurns());
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [chatPlanner, setChatPlanner] = useState<AgentChatResult["planner"] | null>(null);
  const [chatToolCalls, setChatToolCalls] = useState<ToolCallView[]>([]);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => loadLlmSettings());
  const [activeView, setActiveView] = useState<SidebarView>("chat");
  const [boardKnowledge, setBoardKnowledge] = useState<BoardKnowledge | null>(null);
  const [portsMessage, setPortsMessage] = useState("尚未扫描串口");
  const [probeResult, setProbeResult] = useState<Record<string, unknown> | null>(null);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeDocument[]>([]);
  const [knowledgeHits, setKnowledgeHits] = useState<KnowledgeHit[]>([]);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [memoryState, setMemoryState] = useState<MemoryApiState | null>(null);
  const [memoryStatus, setMemoryStatus] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [skills, setSkills] = useState<CapabilityDefinition[]>([]);
  const [mcps, setMcps] = useState<CapabilityDefinition[]>([]);
  const [capabilityStatus, setCapabilityStatus] = useState("");
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");
  const [activeChatRequest, setActiveChatRequest] = useState<ActiveChatRequest | null>(() => loadActiveChatRequest());
  const activeChatControllerRef = useRef<AbortController | null>(null);
  const activeChatTurnRef = useRef<string | null>(null);
  const recoveredChatRequestsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/esp/environment")
      .then((response) => response.json())
      .then(setEnvironment)
      .catch((err) => setEnvironment({ error: err instanceof Error ? err.message : String(err) }));
    fetch("/api/boards/pinouts")
      .then((response) => response.json())
      .then((data) => setBoardKnowledge(normalizeBoardKnowledge(data)))
      .catch(() => setBoardKnowledge(null));
    refreshPorts();
    refreshPreflight();
    refreshKnowledgeFiles();
    refreshMemoryState();
    refreshCapabilities();
    const pendingRequest = loadActiveChatRequest();
    if (pendingRequest && conversationTurns.some((turn) => turn.id === pendingRequest.turnId && turn.planner?.mode === "pending")) {
      if (isActiveChatRequestExpired(pendingRequest)) {
        markTurnStopped(pendingRequest.turnId, setConversationTurns);
        clearActiveChatRequest();
        setActiveChatRequest(null);
      } else {
        setChatLoading(true);
        activeChatTurnRef.current = pendingRequest.turnId;
      }
    }
  }, []);

  useEffect(() => {
    saveState(form, hardwareChecks, peripherals);
  }, [form, hardwareChecks, peripherals]);

  useEffect(() => {
    saveLlmSettings(llmSettings);
  }, [llmSettings]);

  useEffect(() => {
    saveConversationTurns(conversationTurns);
  }, [conversationTurns]);

  function applyAgentChatResult(turnId: string, data: AgentChatResult, source: "fetch" | "status") {
    setChatPlanner(data.planner || null);
    const toolCalls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
    const assistant = data.messages?.find((item) => item.role === "assistant")?.content || data.summary || "任务已完成。";
    setChatToolCalls(toolCalls);
    const taskAcceptance = asRecord(data.result?.task_acceptance);
    const resultSuccess = taskAcceptance.task_success !== undefined
      ? Boolean(taskAcceptance.task_success)
      : data.result?.success !== false;
    setConversationTurns((items) => items.map((item) => item.id === turnId
      ? {
          ...item,
          assistant,
          planner: data.planner,
          toolCalls,
          result: data.result,
          progress: {
            ...(item.progress || {}),
            stage: resultSuccess ? "completed" : "acceptance_failed",
            label: resultSuccess ? "本轮完成" : "任务验收未通过",
            detail: resultSuccess
              ? stringValue(taskAcceptance.verdict) || (source === "status" ? "已从状态恢复最终结果。" : "最终结果已返回。")
              : stringValue(taskAcceptance.verdict) || data.result?.summary || "模型按当前任务验收后判定未通过，已生成诊断报告。",
            status: resultSuccess ? "done" : "failed",
            updatedAt: new Date().toISOString(),
            flow: inferAgentFlow(data)
          }
        }
      : item
    ));
    if (data.result?.steps) {
      setResult(data.result);
    }
  }

  function inferAgentFlow(data: AgentChatResult): ChatProgress["flow"] {
    const toolNames = (Array.isArray(data.tool_calls) ? data.tool_calls : [])
      .map((tool) => String(tool.name || ""))
      .filter(Boolean);
    const effectiveTools = toolNames.filter((name) => name !== "rag_knowledge_search");
    const intent = String(data.planner?.intent || "");
    if (effectiveTools.length === 0 || intent === "chat_only") return "chat";
    if (effectiveTools.some((name) => name === "skill_invocation" || name === "mcp_invocation")) return "capability";
    if (effectiveTools.some((name) => name.includes("diagnose") || name.includes("serial"))) return "diagnosis";
    if (effectiveTools.some((name) => name.includes("firmware") || name.includes("compile") || name.includes("closed_loop"))) return "firmware";
    if (/firmware|closed_loop|hardware|tool/i.test(intent)) return "firmware";
    return "chat";
  }

  async function recoverAgentChatResultFromStatus(requestId: string, turnId: string) {
    try {
      const response = await fetch(`/api/agent/chat/status/${encodeURIComponent(requestId)}`);
      if (!response.ok) return false;
      const data = await response.json() as ChatStatusResponse;
      if (!data.status?.finalResult) return false;
      applyAgentChatResult(turnId, data.status.finalResult, "status");
      recoveredChatRequestsRef.current.add(requestId);
      clearActiveChatRequest();
      setActiveChatRequest((current) => current?.requestId === requestId ? null : current);
      setChatLoading(false);
      if (activeChatTurnRef.current === turnId) activeChatTurnRef.current = null;
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!activeChatRequest?.requestId || !activeChatRequest.turnId) return undefined;
    const request = activeChatRequest;
    let stopped = false;
    async function refreshChatStatus() {
      try {
        const response = await fetch(`/api/agent/chat/status/${encodeURIComponent(request.requestId)}`);
        if (response.status === 404) {
          markTurnStopped(request.turnId, setConversationTurns, "后端没有找到这轮请求状态，已在前端停止。");
          clearActiveChatRequest();
          setActiveChatRequest((current) => current?.requestId === request.requestId ? null : current);
          setChatLoading(false);
          if (activeChatTurnRef.current === request.turnId) activeChatTurnRef.current = null;
          return;
        }
        if (!response.ok) return;
        const data = await response.json() as ChatStatusResponse;
        if (stopped || !data.status) return;
        const progress = data.status;
        if (progress.finalResult) {
          applyAgentChatResult(request.turnId, progress.finalResult, "status");
          recoveredChatRequestsRef.current.add(request.requestId);
          clearActiveChatRequest();
          setActiveChatRequest((current) => current?.requestId === request.requestId ? null : current);
          setChatLoading(false);
          if (activeChatTurnRef.current === request.turnId) activeChatTurnRef.current = null;
          return;
        }
        setConversationTurns((items) => items.map((item) => {
          if (item.id !== request.turnId) return item;
          if (progress.status === "failed") {
            return {
              ...item,
              assistant: progress.finalError || progress.detail ? `执行失败：${progress.finalError || progress.detail}` : "执行失败，请查看后端日志。",
              planner: { mode: "error", intent: "failed", reason: progress.finalError || progress.detail || "backend_status_failed" },
              progress
            };
          }
          if (progress.status === "stopped") {
            return {
              ...item,
              assistant: "已停止本轮思考。",
              planner: { mode: "stopped", intent: "stopped", reason: progress.detail || "backend_status_stopped" },
              progress
            };
          }
          if (progress.status === "done" && item.planner?.mode === "pending") {
            return {
              ...item,
              assistant: isPlaceholderAssistant(item.assistant) ? "" : item.assistant,
              planner: { mode: "completed", intent: "completed", reason: progress.detail || "backend_status_done" },
              progress
            };
          }
          return { ...item, progress };
        }));
        if (progress.status === "done" || progress.status === "failed" || progress.status === "stopped") {
          clearActiveChatRequest();
          setActiveChatRequest((current) => current?.requestId === request.requestId ? null : current);
          setChatLoading(false);
          if (activeChatTurnRef.current === request.turnId) activeChatTurnRef.current = null;
        }
      } catch {
        // Status polling is best-effort; the main request still owns the final result.
      }
    }
    refreshChatStatus();
    const timer = window.setInterval(refreshChatStatus, 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeChatRequest?.requestId, activeChatRequest?.turnId]);

  const hardwareStatus = useMemo<HardwareStatusSnapshot>(() => ({
    form: applyPeripheralsToForm(resetPeripheralPins(form), activePeripherals(peripherals)),
    hardwareChecks,
    peripherals: activePeripherals(peripherals),
    boardPinMap: getBoardPinMap(form.board_model, boardKnowledge),
    selectedPort: form.port.trim(),
    readyForCompile: Boolean(preflight?.ready_for_compile),
    readyForUpload: Boolean(preflight?.ready_for_upload),
    availablePorts: ports.map((port) => port.device).filter(Boolean),
    portsMessage,
    probeResult,
    updatedAt: new Date().toISOString()
  }), [form, hardwareChecks, peripherals, ports, portsMessage, preflight, probeResult, boardKnowledge]);
  const pendingConversationTurn = useMemo(
    () => [...conversationTurns].reverse().find((turn) => isTurnPending(turn)) || null,
    [conversationTurns]
  );
  const syncingCompletedRequest = useMemo(() => Boolean(
    activeChatRequest && conversationTurns.some((turn) =>
      turn.id === activeChatRequest.turnId &&
      turn.progress?.status === "done" &&
      !isTurnPending(turn)
    )
  ), [activeChatRequest, conversationTurns]);
  const conversationBusy = chatLoading || Boolean(activeChatRequest) || Boolean(pendingConversationTurn);

  useEffect(() => {
    saveHardwareStatus(hardwareStatus);
  }, [hardwareStatus]);

  async function refreshPreflight() {
    try {
      const response = await fetch("/api/esp/preflight");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Preflight failed");
      setPreflight(data);
      const autoPort = selectBestPreflightPort(data);
      if (autoPort) {
        setForm((current) => current.port.trim() ? current : { ...current, port: autoPort });
        setPortsMessage(`硬件预检检测到可用串口 ${autoPort}，已自动选中；执行任务时将自动烧录到该端口。`);
      }
    } catch {
      setPreflight(null);
    }
  }

  async function refreshKnowledgeFiles() {
    try {
      const response = await fetch("/api/knowledge/files");
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Knowledge files request failed");
      setKnowledgeFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setKnowledgeStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function uploadKnowledgeDocument(input: { filename: string; title: string; content: string; tags: string; section: string }) {
    setKnowledgeLoading(true);
    setKnowledgeStatus("");
    try {
      const response = await fetch("/api/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: input.filename,
          title: input.title,
          content: input.content,
          tags: input.tags.split(",").map((item) => item.trim()).filter(Boolean),
          source: "web_page",
          section: input.section
        })
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Knowledge upload failed");
      setKnowledgeStatus(`已上传并索引：${data.document?.filename || input.filename}`);
      await refreshKnowledgeFiles();
    } catch (err) {
      setKnowledgeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function deleteKnowledgeDocumentById(id: string) {
    if (!id) return;
    setKnowledgeLoading(true);
    setKnowledgeStatus("正在删除知识库文件...");
    try {
      const response = await fetch(`/api/knowledge/files/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Knowledge delete failed");
      setKnowledgeStatus(`已删除：${data.deleted?.filename || id}`);
      await refreshKnowledgeFiles();
    } catch (err) {
      setKnowledgeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function searchKnowledgeDocuments(query: string) {
    setKnowledgeLoading(true);
    setKnowledgeStatus("");
    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 6 })
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Knowledge search failed");
      setKnowledgeHits(Array.isArray(data.hits) ? data.hits : []);
      setKnowledgeStatus(`检索完成：${Array.isArray(data.hits) ? data.hits.length : 0} 条命中`);
    } catch (err) {
      setKnowledgeStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function refreshMemoryState() {
    try {
      const response = await fetch("/api/memory/state");
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Memory state request failed");
      setMemoryState(data);
      setMemoryStatus(data.state?.updated_at ? `最近更新：${formatDateTime(data.state.updated_at)}` : "记忆已加载");
    } catch (err) {
      setMemoryStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearServerMemory() {
    setMemoryLoading(true);
    try {
      const response = await fetch("/api/memory/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_hardware: true })
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Memory clear failed");
      setMemoryStatus("已清除对话记忆，保留当前硬件状态。");
      await refreshMemoryState();
    } catch (err) {
      setMemoryStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setMemoryLoading(false);
    }
  }

  async function clearChatAndMemory() {
    stopAgentChat();
    setConversationTurns([]);
    setActiveTurnId(null);
    setChatPlanner(null);
    setChatToolCalls([]);
    clearConversationTurns();
    await clearServerMemory();
  }

  async function exportServerMemory() {
    setMemoryLoading(true);
    try {
      const response = await fetch("/api/memory/export");
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Memory export failed");
      downloadMarkdown(`embex_memory_${Date.now()}.json`, [JSON.stringify(data, null, 2)]);
      setMemoryStatus("记忆已导出。");
    } catch (err) {
      setMemoryStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setMemoryLoading(false);
    }
  }

  async function refreshCapabilities() {
    try {
      const [skillResponse, mcpResponse] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/mcps")
      ]);
      const [skillData, mcpData] = await Promise.all([
        skillResponse.json(),
        mcpResponse.json()
      ]);
      if (!skillResponse.ok || skillData.success === false) throw new Error(skillData.message || "Skills request failed");
      if (!mcpResponse.ok || mcpData.success === false) throw new Error(mcpData.message || "MCP request failed");
      setSkills(Array.isArray(skillData.skills) ? skillData.skills : []);
      setMcps(Array.isArray(mcpData.mcps) ? mcpData.mcps : []);
      setCapabilityStatus("Skill / MCP 注册表已加载。");
    } catch (err) {
      setCapabilityStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function setCapabilityEnabled(kind: "skill" | "mcp", name: string, enabled: boolean) {
    setCapabilityLoading(true);
    try {
      const response = await fetch(`/api/${kind === "skill" ? "skills" : "mcps"}/${encodeURIComponent(name)}/enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "Capability update failed");
      setCapabilityStatus(`${kind === "skill" ? "Skill" : "MCP"} ${name} 已${enabled ? "启用" : "禁用"}。`);
      await refreshCapabilities();
    } catch (err) {
      setCapabilityStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCapabilityLoading(false);
    }
  }

  async function refreshPorts() {
    setPortsMessage("正在扫描串口...");
    try {
      const response = await fetch("/api/esp/ports");
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || data.summary || "Serial port scan failed");
      const scannedPorts = Array.isArray(data.ports) ? data.ports : [];
      setPorts(scannedPorts);
      const autoPort = selectBestSerialPort(scannedPorts);
      if (autoPort) {
        setForm((current) => current.port.trim() ? current : { ...current, port: autoPort });
        setPortsMessage(`检测到可用串口 ${autoPort}，已自动选中；执行任务时将自动烧录到该端口。`);
      } else {
        setPortsMessage(data.summary || `发现 ${scannedPorts.length} 个串口`);
      }
    } catch (err) {
      setPorts([]);
      setPortsMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function probeSelectedPort() {
    const port = form.port.trim();
    if (!port) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const response = await fetch("/api/esp/probe-serial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, baud: 115200 })
      });
      const data = await response.json();
      setProbeResult(data);
    } catch (err) {
      setProbeResult({ success: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setProbing(false);
    }
  }

  async function runClosedLoop() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/esp/closed-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Closed-loop request failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function diagnoseManualLog() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/esp/diagnose-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log: manualLog })
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || data.summary || "Manual log diagnosis failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runAgentChat() {
    const message = chatInput.trim();
    if (!message || conversationBusy) return;
    activeChatControllerRef.current?.abort();
    const controller = new AbortController();
    activeChatControllerRef.current = controller;
    const requestLlmSettings = {
      ...llmSettings,
      mode: "auto" as const
    };
    setChatLoading(true);
    setError("");
    setChatInput("");
    const pendingTurnId = `turn-${Date.now()}`;
    const requestId = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const activeRequest = { requestId, turnId: pendingTurnId, startedAt: new Date().toISOString() };
    setActiveChatRequest(activeRequest);
    saveActiveChatRequest(activeRequest);
    setConversationTurns((items) => [
      ...items,
      {
        id: pendingTurnId,
        user: message,
        assistant: "正在思考...",
        planner: { mode: "pending", intent: "pending", reason: "request_in_progress" },
        toolCalls: [],
        progress: {
          stage: "sending",
          label: "发送请求",
          detail: "正在把任务发送到 Embex 后端。",
          status: "running",
          startedAt: activeRequest.startedAt,
          updatedAt: activeRequest.startedAt
        }
      }
    ]);
    setActiveTurnId(pendingTurnId);
    activeChatTurnRef.current = pendingTurnId;
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          requestId,
          log: manualLog,
          closedLoop: form,
          hardwareStatus,
          peripherals: activePeripherals(peripherals),
          history: conversationTurns.slice(-8).flatMap((turn) => [
            { role: "user", content: turn.user },
            { role: "assistant", content: turn.assistant }
          ]),
          llm: requestLlmSettings,
          mode: requestLlmSettings.mode
        })
      });
      const data = (await response.json()) as AgentChatResult;
      if (!response.ok || data.success === false) {
        throw new Error(data.message || data.summary || "Agent chat failed");
      }
      applyAgentChatResult(pendingTurnId, data, "fetch");
    } catch (err) {
      if (controller.signal.aborted) {
        clearActiveChatRequest();
        setActiveChatRequest(null);
        markTurnStopped(pendingTurnId, setConversationTurns);
        return;
      }
      if (recoveredChatRequestsRef.current.has(requestId)) {
        return;
      }
      const recovered = await recoverAgentChatResultFromStatus(requestId, pendingTurnId);
      if (recovered) return;
      const messageText = err instanceof Error ? err.message : String(err);
      setError(messageText);
      setConversationTurns((items) => items.map((item) => item.id === pendingTurnId
        ? {
            ...item,
            assistant: `执行失败：${messageText}`,
            planner: { mode: "error", intent: "failed", reason: messageText },
            toolCalls: [],
            progress: {
              stage: "failed",
              label: "执行失败",
              detail: messageText,
              status: "failed",
              updatedAt: new Date().toISOString()
            }
          }
        : item
      ));
    } finally {
      if (activeChatControllerRef.current === controller) {
        activeChatControllerRef.current = null;
        activeChatTurnRef.current = null;
      }
      clearActiveChatRequest();
      setActiveChatRequest(null);
      setChatLoading(false);
      refreshMemoryState();
    }
  }

  async function stopAgentChat() {
    activeChatControllerRef.current?.abort();
    const storedRequest = activeChatRequest || loadActiveChatRequest();
    if (storedRequest?.requestId) {
      fetch("/api/agent/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: storedRequest.requestId })
      }).catch(() => undefined);
    }
    const pendingTurnId = activeChatTurnRef.current || storedRequest?.turnId || pendingConversationTurn?.id || null;
    if (pendingTurnId) {
      markTurnStopped(pendingTurnId, setConversationTurns);
    }
    setConversationTurns((items) => items.map((item) => isTurnPending(item) ? stoppedTurn(item) : item));
    clearActiveChatRequest();
    setActiveChatRequest(null);
    activeChatControllerRef.current = null;
    activeChatTurnRef.current = null;
    setChatLoading(false);
  }

  const headline = useMemo(() => {
    if (!result) return "Embex";
    return result.success ? "闭环流程已完成" : "任务验收未通过";
  }, [result]);
  const selectedTurn = conversationTurns.find((item) => item.id === activeTurnId) || conversationTurns.at(-1) || null;

  return (
    <main className="workbench">
      <Sidebar activeView={activeView} onChange={setActiveView} />
      <section className={activeView === "chat" ? "mainWorkspace chatPage" : "mainWorkspace featurePage"}>
        <header className="chatHeader">
          <div>
            <p className="eyebrow">Embex · ESP 系列开发板 · PlatformIO · ReAct</p>
            <h1>{activeView === "chat" ? headline : viewTitle(activeView)}</h1>
          </div>
          <div className="statusPills">
            <span>智能判断</span>
            <span>{syncingCompletedRequest ? "syncing result" : conversationBusy ? "thinking" : chatPlanner?.mode || "planner idle"}</span>
            <span>{preflight?.ready_for_upload ? "串口就绪" : "等待串口"}</span>
            <span>{form.port.trim() ? `烧录端口 ${form.port.trim()}` : "未选择烧录端口"}</span>
          </div>
        </header>

        {activeView === "chat" ? (
          <ConversationPanel
            activeTurnId={activeTurnId}
            capabilities={[...skills.map((item) => ({ ...item, kind: "skill" as const })), ...mcps.map((item) => ({ ...item, kind: "mcp" as const }))]}
            disabled={conversationBusy || memoryLoading}
            input={chatInput}
            onChange={setChatInput}
            onClear={clearChatAndMemory}
            onSelectTurn={setActiveTurnId}
            onSend={runAgentChat}
            onStop={stopAgentChat}
            selectedPort={form.port}
            syncing={syncingCompletedRequest}
            turns={conversationTurns}
          />
        ) : (
          <div className="featureContent">
            <DetailPanel
              activeView={activeView}
              capabilityLoading={capabilityLoading}
              capabilityStatus={capabilityStatus}
              environment={environment}
              error={error}
              form={form}
              hardwareChecks={hardwareChecks}
              peripherals={peripherals}
              loading={loading}
              knowledgeFiles={knowledgeFiles}
              knowledgeHits={knowledgeHits}
              knowledgeLoading={knowledgeLoading}
              knowledgeStatus={knowledgeStatus}
              memoryLoading={memoryLoading}
              memoryState={memoryState}
              memoryStatus={memoryStatus}
              mcps={mcps}
              manualLog={manualLog}
              onDiagnoseManualLog={diagnoseManualLog}
              onExportHardware={() => exportHardwareHandoff(form, hardwareChecks, peripherals)}
              onExportReport={() => result && exportReport(form, hardwareChecks, result, peripherals, selectedTurn, selectedTurn?.toolCalls || chatToolCalls)}
              onFormChange={setForm}
              onHardwareToggle={(key) => setHardwareChecks({ ...hardwareChecks, [key]: !hardwareChecks[key] })}
              onPeripheralsChange={setPeripherals}
              onSavePeripherals={() => {
                const cleanedPeripherals = activePeripherals(peripherals);
                const syncedForm = applyPeripheralsToForm(resetPeripheralPins(form), cleanedPeripherals);
                setPeripherals(cleanedPeripherals);
                setForm(syncedForm);
                saveState(syncedForm, hardwareChecks, cleanedPeripherals);
              }}
              onLlmChange={setLlmSettings}
              onManualLogChange={setManualLog}
              onKnowledgeDelete={deleteKnowledgeDocumentById}
              onKnowledgeSearch={searchKnowledgeDocuments}
              onKnowledgeUpload={uploadKnowledgeDocument}
              onCapabilityToggle={setCapabilityEnabled}
              onMemoryClear={clearServerMemory}
              onMemoryExport={exportServerMemory}
              onMemoryRefresh={refreshMemoryState}
              onProbeSelectedPort={probeSelectedPort}
              onRefreshPorts={refreshPorts}
              onRefreshPreflight={refreshPreflight}
              onRunClosedLoop={runClosedLoop}
              boardKnowledge={boardKnowledge}
              planner={selectedTurn?.planner || chatPlanner}
              ports={ports}
              portsMessage={portsMessage}
              preflight={preflight}
              probing={probing}
              probeResult={probeResult}
              result={selectedTurn?.result || result}
              selectedTurn={selectedTurn}
              skills={skills}
              toolCalls={selectedTurn?.toolCalls || chatToolCalls}
              llmSettings={llmSettings}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function PreflightStatus({ preflight, onRefresh }: { preflight: PreflightResult | null; onRefresh: () => void }) {
  const selftestCount = preflight?.selftest?.cases?.length ?? 0;
  return (
    <div className="preflight">
      <div className="preflightHead">
        <strong>联调预检</strong>
        <button className="miniButton" type="button" onClick={onRefresh}>刷新</button>
      </div>
      {!preflight ? (
        <span className="muted">预检未完成</span>
      ) : (
        <>
          <div className={preflight.ready_for_compile ? "check done" : "check"}>
            <CheckCircle2 size={14} />
            <span>编译环境 {preflight.ready_for_compile ? "就绪" : "未就绪"}</span>
          </div>
          <div className={preflight.ready_for_upload ? "check done" : "check"}>
            <CheckCircle2 size={14} />
            <span>烧录条件 {preflight.ready_for_upload ? "就绪" : "等待 USB-UART"}</span>
          </div>
          <div className={preflight.selftest?.success ? "check done" : "check"}>
            <CheckCircle2 size={14} />
            <span>诊断自测 {preflight.selftest?.success ? `${selftestCount} 项通过` : "未通过"}</span>
          </div>
          <p>{preflight.next_step}</p>
        </>
      )}
    </div>
  );
}

function viewTitle(view: SidebarView) {
  const titles: Record<SidebarView, string> = {
    chat: "Embex 对话",
    model: "模型设置",
    hardware: "硬件配置",
    knowledge: "知识与能力",
    memory: "长期记忆",
    reports: "诊断报告",
  };
  return titles[view];
}

function Sidebar({ activeView, onChange }: { activeView: SidebarView; onChange: (view: SidebarView) => void }) {
  const items: Array<{ id: SidebarView; label: string; icon: React.ReactNode }> = [
    { id: "chat", label: "Chat", icon: <MessageSquare size={17} /> },
    { id: "model", label: "Model", icon: <Settings size={17} /> },
    { id: "hardware", label: "Hardware", icon: <Cpu size={17} /> },
    { id: "knowledge", label: "Knowledge", icon: <FileText size={17} /> },
    { id: "memory", label: "Memory", icon: <HardDrive size={17} /> },
    { id: "reports", label: "Reports", icon: <FileText size={17} /> }
  ];
  return (
    <aside className="sidebar">
      <div className="brandBlock">
        <strong>Embex</strong>
        <span>ESP Copilot</span>
      </div>
      <nav className="sideNav">
        {items.map((item) => (
          <button
            className={activeView === item.id ? "sideNavItem active" : "sideNavItem"}
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function ConversationPanel({
  activeTurnId,
  capabilities,
  disabled,
  input,
  onChange,
  onClear,
  onSelectTurn,
  onSend,
  onStop,
  selectedPort,
  syncing,
  turns
}: {
  activeTurnId: string | null;
  capabilities: Array<CapabilityDefinition & { kind: "skill" | "mcp" }>;
  disabled: boolean;
  input: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSelectTurn: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  selectedPort: string;
  syncing: boolean;
  turns: ConversationTurn[];
}) {
  const normalizedPort = selectedPort.trim();
  const streamRef = useRef<HTMLDivElement | null>(null);
  const slashQuery = input.startsWith("/") ? input.slice(1).trim().toLowerCase() : "";
  const slashCandidates = input.startsWith("/")
    ? capabilities
      .filter((item) => item.enabled)
      .filter((item) => {
        if (!slashQuery) return true;
        return [item.name, item.title, item.description, item.category].some((value) => String(value || "").toLowerCase().includes(slashQuery));
      })
      .slice(0, 8)
    : [];

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    const isComposing = Boolean(nativeEvent.isComposing);
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !event.ctrlKey
      && !event.altKey
      && !event.metaKey
      && !isComposing
    ) {
      event.preventDefault();
      if (!disabled && input.trim()) {
        onSend();
      }
    }
  }

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [turns.length, activeTurnId]);

  return (
    <section className="conversationShell">
      <div className="conversationStream" ref={streamRef}>
        {turns.length === 0 ? (
          <div className="welcomePanel">
            <MessageSquare size={28} />
            <h2>和 Embex 对话</h2>
            <p>直接输入问题或硬件任务，Embex 会判断是普通回答，还是调用 ESP 工具完成代码生成、编译、烧录和诊断。</p>
          </div>
        ) : (
          <div className="messageList">
            {turns.map((turn) => (
              <div className="turnMessages" key={turn.id}>
                <div className="messageRow user">
                  <div className="messageAvatar">你</div>
                  <div className="messageBubble">
                    <strong>用户</strong>
                    <p>{turn.user}</p>
                  </div>
                </div>
                <div className="messageRow assistant">
                  <div className="messageAvatar">CW</div>
                  <div className="messageBubble">
                    <strong>Embex</strong>
                    {isTurnPending(turn) ? (
                      <PendingProgress progress={turn.progress} />
                    ) : (
                      <>
                        {turn.assistant ? <p>{turn.assistant}</p> : <p className="muted">模型已完成后端流程，正在同步最终回复...</p>}
                        {turn.progress && <PendingProgress progress={turn.progress} />}
                      </>
                    )}
                    {isTurnPending(turn) && (
                      <button className="inlineStopButton" type="button" onClick={onStop}>
                        停止思考
                      </button>
                    )}
                    {turn.toolCalls.length > 0 && (
                      <div className="inlineTools">
                        {turn.toolCalls.map((tool, toolIndex) => (
                          <span className={tool.success === false ? "inlineTool badText" : "inlineTool okText"} key={`${tool.name}-${toolIndex}`}>
                            {toolTypeLabel(tool)} · {toolDisplayName(tool)}
                          </span>
                        ))}
                      </div>
                    )}
                    {turn.toolCalls.length > 0 && (
                      <div className="inlineToolSummaries">
                        {turn.toolCalls.map((tool, toolIndex) => (
                          <ToolCallSummary compact key={`${tool.name}-summary-${toolIndex}`} tool={tool} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="composer">
        <div className={normalizedPort ? "selectedPortNotice ready" : "selectedPortNotice"}>
          <Cable size={16} />
          <span>{normalizedPort ? `当前烧录端口：${normalizedPort}，执行工具任务时会自动烧录到该端口。` : "当前未选择烧录端口：工具任务只会生成和编译，不会烧录。"}</span>
        </div>
        <textarea
          aria-label="自然语言任务"
          placeholder="输入任务、问题或故障现象。例如：AHT20 无响应，请读取串口日志并诊断。"
          value={input}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
        />
        {slashCandidates.length > 0 && (
          <div className="slashMenu">
            {slashCandidates.map((item) => (
              <button
                key={`${item.kind}-${item.name}`}
                type="button"
                onClick={() => onChange(`${item.invocation || `/${item.name}`} `)}
              >
                <span>{item.kind.toUpperCase()}</span>
                <strong>{item.invocation || `/${item.name}`}</strong>
                <small>{item.title}</small>
              </button>
            ))}
          </div>
        )}
        <div className="composerActions">
          <button className="ghost" disabled={turns.length === 0 || disabled} type="button" onClick={onClear}>
            清空对话与记忆
          </button>
          {disabled && syncing ? (
            <button className="ghost" disabled type="button">
              同步结果
            </button>
          ) : disabled ? (
            <button className="stopButton" type="button" onClick={onStop}>
              停止思考
            </button>
          ) : (
            <button className="primary" disabled={input.trim().length === 0} type="button" onClick={onSend}>
              <Play size={18} />
              发送
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function PendingProgress({ progress }: { progress?: ChatProgress }) {
  const rawStage = progress?.stage || "sending";
  const stageAliases: Record<string, string> = {
    queued: "request_received",
    sending: "request_received",
    capability_invocation: "capability",
    diagnose_log: "serial_observation",
    list_ports: "firmware_tool",
    probe_serial: "firmware_tool",
    firmware_validation_failed: "react_loop",
    finalizing: "acceptance",
    acceptance_failed: "acceptance",
    failed: "completed",
    stopped: "completed"
  };
  const stage = stageAliases[rawStage] || rawStage;
  const status = progress?.status || "running";
  const firmwareSteps = [
    { key: "request_received", label: "接收任务" },
    { key: "model_reasoning", label: "模型规划" },
    { key: "react_loop", label: "ReAct 决策" },
    { key: "main_cpp_generation", label: "编写 main.cpp" },
    { key: "firmware_tool", label: "工具执行" },
    { key: "serial_observation", label: "串口观测" },
    { key: "acceptance", label: "验收/重思考" },
    { key: "completed", label: "返回结果" }
  ];
  const flowSteps: Record<NonNullable<ChatProgress["flow"]>, typeof firmwareSteps> = {
    chat: [
      { key: "request_received", label: "接收任务" },
      { key: "model_reasoning", label: "模型规划" },
      { key: "completed", label: "返回结果" }
    ],
    capability: [
      { key: "request_received", label: "接收任务" },
      { key: "model_reasoning", label: "模型规划" },
      { key: "capability", label: "调用能力" },
      { key: "completed", label: "返回结果" }
    ],
    diagnosis: [
      { key: "request_received", label: "接收任务" },
      { key: "model_reasoning", label: "模型规划" },
      { key: "serial_observation", label: "日志观测" },
      { key: "acceptance", label: "诊断总结" },
      { key: "completed", label: "返回结果" }
    ],
    firmware: firmwareSteps
  };
  const steps = flowSteps[progress?.flow || "firmware"];
  const matchedIndex = steps.findIndex((item) => item.key === stage);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : Math.max(0, steps.findIndex((item) => item.key === "model_reasoning"));
  const elapsed = progress?.startedAt ? formatElapsed(Date.now() - Date.parse(progress.startedAt)) : "";
  const showSpinner = status === "running";
  return (
    <div className="pendingProgress">
      <div className="pendingStatusLine">
        {showSpinner ? <Loader2 className="spin inlineSpinner" size={15} /> : <CheckCircle2 className="inlineSpinner" size={15} />}
        <span>{progress?.label || "正在处理"}</span>
        {elapsed && <small>{elapsed}</small>}
      </div>
      {progress?.detail && <p className="pendingDetail">{progress.detail}</p>}
      <div className="flowSteps" aria-label="Embex 执行流程">
        {steps.map((item, index) => {
          const done = stage === "completed" || index < activeIndex;
          const active = index === activeIndex && status === "running";
          return (
            <div className={done ? "flowStep done" : active ? "flowStep active" : "flowStep"} key={item.key}>
              <span>{done ? <CheckCircle2 size={13} /> : active ? <Loader2 className="spin" size={13} /> : index + 1}</span>
              <small>{item.label}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isTurnPending(turn: ConversationTurn) {
  return turn.planner?.mode === "pending" && (turn.progress?.status || "running") === "running";
}

function isPlaceholderAssistant(value: string) {
  return ["正在思考...", "正在思考…"].includes(String(value || "").trim());
}

function knowledgeSectionKey(filename: string) {
  const normalized = String(filename || "").replace(/\\/g, "/");
  const firstPart = normalized.split("/")[0] || "";
  if (firstPart.includes(".")) {
    if (firstPart.startsWith("00_")) return "00_embex_rules";
    if (firstPart.startsWith("01_")) return "01_boards_platformio";
    if (firstPart.startsWith("02_")) return "02_peripherals";
    if (firstPart.startsWith("03_")) return "03_debug_cases";
    if (firstPart.startsWith("04_")) return "04_pinouts";
    if (firstPart.startsWith("05_")) return "05_project_cases";
    return "uploads";
  }
  if (firstPart) return firstPart;
  return "uploads";
}

function knowledgeSectionFallbackLabel(key: string) {
  if (key === "uploads") return "用户上传资料";
  return key.replace(/[_-]/g, " ");
}

function isUserKnowledgeFile(file: KnowledgeDocument) {
  const source = String(file.source || "").toLowerCase();
  return ["web_upload", "web_page", "upload", "uploads", "user_upload"].includes(source) || file.filename.startsWith("uploads/");
}

function KnowledgePanel({
  files,
  hits,
  loading,
  mcps,
  capabilityLoading,
  capabilityStatus,
  onCapabilityToggle,
  onDelete,
  onSearch,
  onUpload,
  skills,
  status
}: {
  files: KnowledgeDocument[];
  hits: KnowledgeHit[];
  loading: boolean;
  mcps: CapabilityDefinition[];
  capabilityLoading: boolean;
  capabilityStatus: string;
  onCapabilityToggle: (kind: "skill" | "mcp", name: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onSearch: (query: string) => void;
  onUpload: (input: { filename: string; title: string; content: string; tags: string; section: string }) => void;
  skills: CapabilityDefinition[];
  status: string;
}) {
  const knowledgeSections = [
    { value: "00_embex_rules", label: "Embex 规则与工作流" },
    { value: "01_boards_platformio", label: "板卡与 PlatformIO" },
    { value: "02_peripherals", label: "外设与驱动" },
    { value: "03_debug_cases", label: "调试案例与故障" },
    { value: "04_pinouts", label: "引脚图与引脚规则" },
    { value: "05_project_cases", label: "项目案例" },
    { value: "uploads", label: "用户上传资料" }
  ];
  const [filename, setFilename] = useState("embex-note.md");
  const [title, setTitle] = useState("Embex 开发记录");
  const [tags, setTags] = useState("esp,embex");
  const [section, setSection] = useState("uploads");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [fileReadStatus, setFileReadStatus] = useState("");
  const canUpload = content.trim().length > 0 && filename.trim().length > 0;
  const indexedFiles = files.filter((file) => file.status === "indexed").length;
  const totalChunks = files.reduce((sum, file) => sum + (Number(file.chunks) || 0), 0);
  const enabledSkills = skills.filter((item) => item.enabled).length;
  const enabledMcps = mcps.filter((item) => item.enabled).length;
  const sectionLabels = new Map(knowledgeSections.map((item) => [item.value, item.label]));
  const groupedFiles = files.reduce<Array<{ key: string; label: string; files: KnowledgeDocument[]; chunks: number }>>((groups, file) => {
    const key = knowledgeSectionKey(file.filename);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = {
        key,
        label: sectionLabels.get(key) || knowledgeSectionFallbackLabel(key),
        files: [],
        chunks: 0
      };
      groups.push(group);
    }
    group.files.push(file);
    group.chunks += Number(file.chunks) || 0;
    return groups;
  }, []);

  function handleKnowledgeFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFilename(file.name);
      setTitle(file.name.replace(/\.[^.]+$/, "") || file.name);
      setContent(text);
      setFileReadStatus(`已读取：${file.name}，${text.length} 字符`);
    };
    reader.onerror = () => setFileReadStatus(`读取失败：${file.name}`);
    reader.readAsText(file);
  }

  return (
    <section className="panel detailCard">
      <div className="sectionHead">
        <div>
          <h2><FileText size={18} /> 知识与能力</h2>
          <p className="muted">这里统一管理 Embex 可检索知识、可调用 Skill 和 MCP。对话中输入 `/` 可以选择已启用能力。</p>
        </div>
      </div>
      {status && <p className="knowledgeStatus knowledgePageStatus">{status}</p>}
      <div className="capabilityStats">
        <article>
          <span>知识文件</span>
          <strong>{indexedFiles}/{files.length}</strong>
          <small>indexed / total</small>
        </article>
        <article>
          <span>知识分块</span>
          <strong>{totalChunks}</strong>
          <small>RAG chunks</small>
        </article>
        <article>
          <span>Skills</span>
          <strong>{enabledSkills}/{skills.length}</strong>
          <small>enabled / total</small>
        </article>
        <article>
          <span>MCP</span>
          <strong>{enabledMcps}/{mcps.length}</strong>
          <small>enabled / total</small>
        </article>
      </div>
      <div className="knowledgeGrid">
        <div className="knowledgeBlock">
          <strong>上传文本资料</strong>
          <label>
            本地文件
            <input
              accept=".md,.markdown,.txt,.log,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.c,.cpp,.h,.hpp,.ino,.ini,.yaml,.yml"
              type="file"
              onChange={(event) => handleKnowledgeFile(event.target.files?.[0])}
            />
          </label>
          {fileReadStatus && <p className="knowledgeStatus">{fileReadStatus}</p>}
          <label>
            写入分区
            <select value={section} onChange={(event) => setSection(event.target.value)}>
              {knowledgeSections.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            文件名
            <input value={filename} onChange={(event) => setFilename(event.target.value)} />
          </label>
          <label>
            标题
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            标签
            <input value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <label>
            内容
            <textarea
              placeholder="粘贴 ESP 开发文档、调试经验、引脚规则、串口日志或注意事项。"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={!canUpload || loading}
            type="button"
            onClick={() => onUpload({ filename, title, content, tags, section })}
          >
            {loading ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
            上传并索引
          </button>
        </div>

        <div className="knowledgeBlock">
          <strong>检索测试</strong>
          <label>
            查询
            <input placeholder="例如 ESP32-C3 OLED SPI" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="primary" disabled={!query.trim() || loading} type="button" onClick={() => onSearch(query)}>
            {loading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            检索
          </button>
          <div className="knowledgeHits">
            {hits.length === 0 ? (
              <p className="muted">暂无命中片段。</p>
            ) : hits.map((hit) => (
              <article className="knowledgeHit" key={hit.id}>
                <strong>{hit.title}</strong>
                <span>{hit.filename} · chunk {hit.chunk_index} · score {hit.score}</span>
                {hit.match_terms?.length ? <small>命中词：{hit.match_terms.join(", ")}</small> : null}
                <p>{hit.text}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <details className="capabilityDropdown knowledgeDropdown" open>
        <summary>
          <span>当前知识库</span>
          <small>{indexedFiles}/{files.length} 文件 · {totalChunks} chunks</small>
        </summary>
        {files.length === 0 ? (
          <div className="knowledgeDropdownBody">
            <p className="muted">知识库暂无文件。</p>
          </div>
        ) : (
          <div className="knowledgeSectionList knowledgeDropdownBody">
            {groupedFiles.map((group) => (
              <details className="capabilityDropdown knowledgeSectionDropdown" key={group.key} open>
                <summary>
                  <span>{group.label}</span>
                  <small>{group.files.length} 文件 · {group.chunks} chunks</small>
                </summary>
                <div className="knowledgeFiles">
                  {group.files.map((file) => (
                    <article className="knowledgeFile" key={file.id}>
                      <div>
                        <strong>{file.title || file.filename}</strong>
                        <span>{file.filename} · {file.type} · {file.chunks} chunks · {formatBytes(file.size)}</span>
                      </div>
                      <div className="knowledgeFileActions">
                        <span className={file.status === "indexed" ? "okText" : "badText"}>{file.status}</span>
                        {isUserKnowledgeFile(file) && (
                          <button className="miniButton danger" disabled={loading} type="button" onClick={() => onDelete(file.id)}>
                            <Trash2 size={13} />
                            删除
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </details>
      <SkillMcpPanel
        compact
        loading={capabilityLoading}
        mcps={mcps}
        onToggle={onCapabilityToggle}
        skills={skills}
        status={capabilityStatus}
      />
    </section>
  );
}

function DetailPanel({
  activeView,
  capabilityLoading,
  capabilityStatus,
  environment,
  error,
  form,
  hardwareChecks,
  peripherals,
  loading,
  knowledgeFiles,
  knowledgeHits,
  knowledgeLoading,
  knowledgeStatus,
  memoryLoading,
  memoryState,
  memoryStatus,
  mcps,
  manualLog,
  onDiagnoseManualLog,
  onCapabilityToggle,
  onExportHardware,
  onExportReport,
  onFormChange,
  onHardwareToggle,
  onPeripheralsChange,
  onSavePeripherals,
  onLlmChange,
  onManualLogChange,
  onKnowledgeDelete,
  onKnowledgeSearch,
  onKnowledgeUpload,
  onMemoryClear,
  onMemoryExport,
  onMemoryRefresh,
  onProbeSelectedPort,
  onRefreshPorts,
  onRefreshPreflight,
  onRunClosedLoop,
  boardKnowledge,
  planner,
  ports,
  portsMessage,
  preflight,
  probing,
  probeResult,
  result,
  selectedTurn,
  skills,
  toolCalls,
  llmSettings
}: {
  activeView: SidebarView;
  capabilityLoading: boolean;
  capabilityStatus: string;
  environment: Record<string, unknown> | null;
  error: string;
  form: ConsoleForm;
  hardwareChecks: HardwareChecks;
  peripherals: PeripheralConfig[];
  loading: boolean;
  knowledgeFiles: KnowledgeDocument[];
  knowledgeHits: KnowledgeHit[];
  knowledgeLoading: boolean;
  knowledgeStatus: string;
  memoryLoading: boolean;
  memoryState: MemoryApiState | null;
  memoryStatus: string;
  mcps: CapabilityDefinition[];
  manualLog: string;
  onDiagnoseManualLog: () => void;
  onCapabilityToggle: (kind: "skill" | "mcp", name: string, enabled: boolean) => void;
  onExportHardware: () => void;
  onExportReport: () => void;
  onFormChange: (value: ConsoleForm) => void;
  onHardwareToggle: (key: keyof HardwareChecks) => void;
  onPeripheralsChange: (value: PeripheralConfig[]) => void;
  onSavePeripherals: () => void;
  onLlmChange: (value: LlmSettings) => void;
  onManualLogChange: (value: string) => void;
  onKnowledgeDelete: (id: string) => void;
  onKnowledgeSearch: (query: string) => void;
  onKnowledgeUpload: (input: { filename: string; title: string; content: string; tags: string; section: string }) => void;
  onMemoryClear: () => void;
  onMemoryExport: () => void;
  onMemoryRefresh: () => void;
  onProbeSelectedPort: () => void;
  onRefreshPorts: () => void;
  onRefreshPreflight: () => void;
  onRunClosedLoop: () => void;
  boardKnowledge: BoardKnowledge | null;
  planner?: AgentChatResult["planner"] | null;
  ports: SerialPortInfo[];
  portsMessage: string;
  preflight: PreflightResult | null;
  probing: boolean;
  probeResult: Record<string, unknown> | null;
  result: ClosedLoopResult | null;
  selectedTurn: ConversationTurn | null;
  skills: CapabilityDefinition[];
  toolCalls: ToolCallView[];
  llmSettings: LlmSettings;
}) {
  if (activeView === "model") {
    return (
      <section className="panel detailCard">
        <h2><Settings size={18} /> 模型设置</h2>
        <ModelSettings settings={llmSettings} onChange={onLlmChange} />
      </section>
    );
  }

  if (activeView === "hardware") {
    return (
      <section className="panel detailCard">
        <h2><Cpu size={18} /> 硬件配置</h2>
        <EnvStatus environment={environment} />
        <PreflightStatus preflight={preflight} onRefresh={onRefreshPreflight} />
        <label>
          Board / Module
          <select value={form.board_model} onChange={(e) => onFormChange(applyBoardPreset(form, e.target.value))}>
            <option value="esp32-s3-n16r8">ESP32-S3-N16R8</option>
            <option value="esp32-s3-n8r8">ESP32-S3-N8R8</option>
            <option value="esp32-s3-n8">ESP32-S3-N8</option>
            <option value="esp32-s3-devkitc-1">ESP32-S3-DevKitC-1</option>
            <option value="luatos-esp32c3-core">LuatOS ESP32C3-CORE / 合宙 ESP32C3 核心板</option>
            <option value="esp32-c3-devkitm-1">ESP32-C3-DevKitM-1</option>
            <option value="esp32-c3-devkitc-02">ESP32-C3-DevKitC-02</option>
            <option value="esp32-devkit-v1">ESP32 DevKit V1 / WROOM-32</option>
            <option value="esp32-wrover">ESP32-WROVER</option>
            <option value="esp8266-nodemcuv2">ESP8266 NodeMCU 1.0 / ESP-12E</option>
            <option value="esp8266-d1-mini">ESP8266 Wemos D1 mini</option>
            <option value="esp8266-esp12e">ESP8266 ESP-12E</option>
          </select>
        </label>
        <BoardPinMapView
          board={getBoardPinMap(form.board_model, boardKnowledge)}
          form={form}
          peripherals={peripherals}
          onChange={onFormChange}
          onPeripheralsChange={onPeripheralsChange}
        />
        <SerialPortSelector
          form={form}
          onChange={onFormChange}
          onProbe={onProbeSelectedPort}
          onRefresh={onRefreshPorts}
          ports={ports}
          portsMessage={portsMessage}
          probeResult={probeResult}
          probing={probing}
        />
        <PeripheralEditor peripherals={peripherals} onChange={onPeripheralsChange} onSave={onSavePeripherals} />
        <HardwareChecklist checks={hardwareChecks} hasConfiguredPeripherals={peripherals.some((item) => item.enabled)} hasPort={Boolean(form.port.trim())} onToggle={onHardwareToggle} ports={ports} preflight={preflight} />
      </section>
    );
  }

  if (activeView === "knowledge") {
    return (
      <KnowledgePanel
        capabilityLoading={capabilityLoading}
        capabilityStatus={capabilityStatus}
        files={knowledgeFiles}
        hits={knowledgeHits}
        loading={knowledgeLoading}
        mcps={mcps}
        onCapabilityToggle={onCapabilityToggle}
        onDelete={onKnowledgeDelete}
        onSearch={onKnowledgeSearch}
        onUpload={onKnowledgeUpload}
        skills={skills}
        status={knowledgeStatus}
      />
    );
  }

  if (activeView === "memory") {
    return (
      <MemoryPanel
        loading={memoryLoading}
        memory={memoryState}
        onClear={onMemoryClear}
        onExport={onMemoryExport}
        onRefresh={onMemoryRefresh}
        status={memoryStatus}
      />
    );
  }

  if (activeView === "reports") {
    return (
      <section className="panel detailCard">
        <h2><FileText size={18} /> 报告</h2>
        {selectedTurn && (
          <div className="selectedTurnBox">
            <strong>当前轮次</strong>
            <p>{selectedTurn.user}</p>
          </div>
        )}
        {result ? (
          <>
            <RecTraceReport
              planner={selectedTurn?.planner || planner}
              progress={selectedTurn?.progress}
              result={result}
              selectedTurn={selectedTurn}
              toolCalls={toolCalls}
            />
            {result.diagnosis ? (
              <DiagnosisView diagnosis={result.diagnosis} />
            ) : (
              <div className="reportFallback">
                <strong>暂无结构化诊断</strong>
                <p>{result.summary || "本轮工具调用已完成，但结果中没有 diagnosis 字段。"}</p>
              </div>
            )}
            <button className="exportButton" type="button" onClick={onExportReport}>
              <Download size={16} />
              导出报告
            </button>
          </>
        ) : (
          <p className="muted">运行后显示根因、证据和下一步动作。</p>
        )}
      </section>
    );
  }

  return (
    <section className="panel detailCard">
      <h2><Activity size={18} /> 当前上下文</h2>
      {planner && planner.mode !== "pending" ? (
        <div className="plannerBox">
          <span>Planner</span>
          <strong>{planner.intent || "unknown"}</strong>
          <small>{planner.mode || "rule_based_offline"} · {planner.reason || "no reason"}</small>
        </div>
      ) : (
        <p className="muted">尚未开始对话。</p>
      )}
      {toolCalls.length > 0 && (
        <div className="toolTimeline">
          <strong>工具摘要</strong>
          {toolCalls.map((tool, index) => (
            <ToolCallCard key={`${tool.name}-${index}`} tool={tool} />
          ))}
        </div>
      )}
    </section>
  );
}

function ToolCallCard({ tool }: { tool: ToolCallView }) {
  return (
    <article className="toolCall">
      <div className="toolCallHead">
        <span className={tool.success === false ? "toolStatus badText" : "toolStatus okText"}>{tool.success === false ? "failed" : "ok"}</span>
        <span className="toolKind">{toolTypeLabel(tool)}</span>
        <strong>{toolDisplayName(tool)}</strong>
      </div>
      {tool.summary && <p>{tool.summary}</p>}
      <ToolCallSummary tool={tool} />
      <KnowledgeCitations tool={tool} />
      <ToolCallDetails tool={tool} />
    </article>
  );
}

function RecTraceReport({
  planner,
  progress,
  result,
  selectedTurn,
  toolCalls
}: {
  planner?: AgentChatResult["planner"] | null;
  progress?: ChatProgress;
  result: ClosedLoopResult;
  selectedTurn: ConversationTurn | null;
  toolCalls: ToolCallView[];
}) {
  const attempts = buildRecAttempts(toolCalls, result);
  const failedAttempts = attempts.filter((attempt) => attempt.status === "failed").length;
  const acceptance = asRecord(result.task_acceptance);
  const acceptanceEvidence = Array.isArray(acceptance.evidence) ? acceptance.evidence.map(String).filter(Boolean) : [];
  return (
    <div className="recReport">
      <div className="recHead">
        <div>
          <strong>REC 调试轨迹</strong>
          <p>展示本轮可审计的任务理解、执行、观测、修正依据和最终结果。</p>
        </div>
        <span>{attempts.length} 次记录 · {failedAttempts} 次失败</span>
      </div>

      <div className="recMetaGrid">
        <article>
          <span>任务</span>
          <p>{selectedTurn?.user || "未选中具体轮次。"}</p>
        </article>
        <article>
          <span>Planner</span>
          <strong>{planner?.intent || "unknown"}</strong>
          <small>{planner?.mode || "unknown"} · {planner?.reason || "no reason"}</small>
        </article>
        <article>
          <span>进度</span>
          <strong>{progress?.label || (result.success ? "本轮完成" : "本轮异常")}</strong>
          <small>{progress?.status || (result.success ? "done" : "failed")} · {progress?.detail || result.summary || ""}</small>
        </article>
        <article>
          <span>任务验收</span>
          <strong>{acceptance.task_success === undefined ? "未单独验收" : acceptance.task_success ? "通过" : "未通过"}</strong>
          <small>{stringValue(acceptance.judged_by) || "工具/模型结果"} · {stringValue(acceptance.verdict)}</small>
        </article>
      </div>

      {acceptance.task_success !== undefined && (
        <div className="acceptanceDetail">
          <strong>模型验收依据</strong>
          <div className="acceptanceGrid">
            <span>失败节点</span>
            <p>{stringValue(acceptance.failed_node) || "无影响最终任务的失败节点"}</p>
            <span>下一步</span>
            <p>{stringValue(acceptance.next_step) || "无需额外操作"}</p>
            <span>置信度</span>
            <p>{acceptance.confidence !== undefined ? `${Math.round(Number(acceptance.confidence) * 100)}%` : "未提供"}</p>
          </div>
          {acceptanceEvidence.length > 0 && (
            <ul>
              {acceptanceEvidence.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          )}
        </div>
      )}

      {attempts.length === 0 ? (
        <p className="muted">本轮没有可展示的工具调用或执行步骤。</p>
      ) : (
        <div className="recAttemptList">
          {attempts.map((attempt, index) => (
            <article className={`recAttempt ${attempt.status}`} key={`${attempt.kind}-${attempt.name}-${index}`}>
              <div className="recAttemptHead">
                <span>{attempt.kind === "tool" ? `Tool ${index + 1}` : `Step ${index + 1}`}</span>
                <strong>{attempt.name}</strong>
                <small>{attempt.status}</small>
              </div>
              <div className="recGrid">
                <div>
                  <span>Reason</span>
                  <p>{attempt.reason}</p>
                </div>
                <div>
                  <span>Execute</span>
                  <p>{attempt.execute}</p>
                </div>
                <div>
                  <span>Observe</span>
                  <p>{attempt.observe}</p>
                </div>
                <div>
                  <span>Correct / Next</span>
                  <p>{attempt.correct}</p>
                </div>
              </div>
              {attempt.detail !== undefined && attempt.detail !== null && (
                <details className="toolDetails">
                  <summary>查看原始记录</summary>
                  <pre>{safeJson(attempt.detail)}</pre>
                </details>
              )}
            </article>
          ))}
        </div>
      )}

      {selectedTurn?.assistant && (
        <div className="recFinal">
          <strong>模型最终回复</strong>
          <p>{selectedTurn.assistant}</p>
        </div>
      )}
    </div>
  );
}

function KnowledgeCitations({ tool }: { tool: ToolCallView }) {
  const citations = extractKnowledgeCitations(tool);
  if (citations.length === 0) return null;
  return (
    <div className="citationList">
      <strong>知识引用</strong>
      {citations.map((item, index) => (
        <article className="citationItem" key={item.id || `${item.filename}-${item.chunk_index}-${index}`}>
          <span>{item.title || item.filename || "知识片段"}</span>
          <small>{item.filename || "unknown"} · chunk {item.chunk_index ?? "-"}{item.score !== undefined ? ` · score ${item.score}` : ""}</small>
          {item.text && <p>{item.text}</p>}
        </article>
      ))}
    </div>
  );
}

function ToolCallSummary({ tool, compact = false }: { tool: ToolCallView; compact?: boolean }) {
  const items = summarizeToolCall(tool);
  if (items.length === 0) return null;
  return (
    <div className={compact ? "toolSummary compact" : "toolSummary"}>
      {items.map((item) => (
        <div className="toolSummaryItem" key={`${item.label}-${item.value}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

type RecAttempt = {
  kind: "tool" | "step";
  name: string;
  status: "ok" | "failed" | "skipped" | "unknown";
  reason: string;
  execute: string;
  observe: string;
  correct: string;
  detail?: unknown;
};

function buildRecAttempts(toolCalls: ToolCallView[], result?: ClosedLoopResult | null): RecAttempt[] {
  const toolAttempts = (Array.isArray(toolCalls) ? toolCalls : []).map((tool) => {
    const record = tool as Record<string, unknown>;
    const detail = pickToolDetail(tool);
    return {
      kind: "tool" as const,
      name: toolDisplayName(tool),
      status: tool.success === false ? "failed" as const : tool.success === true ? "ok" as const : "unknown" as const,
      reason: inferToolReason(tool),
      execute: summarizeToolExecute(tool),
      observe: summarizeToolObserve(tool),
      correct: summarizeToolCorrection(tool),
      detail: detail || record
    };
  });
  const stepAttempts = (Array.isArray(result?.steps) ? result.steps : []).map((step) => {
    const stepRecord = asRecord(step);
    const stepResult = asRecord(stepRecord.result || stepRecord.output || stepRecord);
    const stepName = stringValue(stepRecord.name) || stringValue(stepRecord.tool) || stringValue(stepRecord.kind) || "unnamed_step";
    const successValue = stepResult.success;
    const status = successValue === null
      ? "skipped" as const
      : successValue === false
        ? "failed" as const
        : successValue === true
          ? "ok" as const
          : "unknown" as const;
    const nextStep = stringValue(stepResult.next_step);
    const diagnosis = asRecord(stepResult.diagnosis);
    return {
      kind: "step" as const,
      name: stepName,
      status,
      reason: inferStepReason({ name: stepName, result: stepResult as ClosedLoopStep["result"] }),
      execute: stepResult.command ? `执行命令：${String(stepResult.command)}` : `执行步骤：${stepName}`,
      observe: stringValue(stepResult.summary) || nextStep || compactLog(String(stepResult.log || "")) || "未返回可读观测。",
      correct: status === "failed"
        ? nextStep || stringValue(diagnosis.next_step) || "需要根据该步骤错误继续修正。"
        : status === "ok"
          ? "该步骤已通过，继续下一步或进入最终验收。"
          : nextStep || "该步骤被跳过或未产生明确结论。",
      detail: step
    };
  });
  return [...toolAttempts, ...stepAttempts];
}

function inferToolReason(tool: ToolCallView) {
  const name = String(tool.name || "");
  if (name.includes("knowledge") || name.includes("rag")) return "根据任务需要检索知识库，补充板卡、外设或调试规则。";
  if (name.includes("compile") || name.includes("firmware")) return "任务涉及固件生成、编译、烧录或串口观测，需要调用固件工具链。";
  if (name.includes("diagnose") || name.includes("log")) return "当前已有日志或失败现象，需要进行日志诊断。";
  if (name.includes("serial") || name.includes("port")) return "任务需要确认串口、硬件连接或设备可用性。";
  if (name.includes("filesystem") || name.includes("project")) return "任务需要读取项目文件或分析工程结构。";
  return "智能体根据当前任务选择该工具获取证据或执行动作。";
}

function summarizeToolExecute(tool: ToolCallView) {
  const args = asRecord(tool.args);
  const summaryParts = [
    args.task_description ? `任务：${String(args.task_description)}` : "",
    args.board_model ? `板卡：${String(args.board_model)}` : "",
    args.port ? `端口：${String(args.port)}` : "",
    args.main_cpp ? `main.cpp：已传入 ${String(args.main_cpp).length} 字符` : "",
    args.query ? `查询：${String(args.query)}` : ""
  ].filter(Boolean);
  return summaryParts.join("；") || tool.summary || `调用工具：${toolDisplayName(tool)}`;
}

function summarizeToolObserve(tool: ToolCallView) {
  const result = asRecord(tool.result);
  const nestedDiagnosis = asRecord(result.diagnosis);
  const pieces = [
    tool.success === false ? "工具返回失败。" : tool.success === true ? "工具返回成功。" : "",
    tool.summary || String(result.summary || ""),
    result.compile_success !== undefined ? `编译：${result.compile_success ? "成功" : "失败"}` : "",
    result.upload_success !== undefined ? `烧录：${result.upload_success ? "成功" : "失败"}` : "",
    result.monitor_success !== undefined ? `串口：${result.monitor_success ? "已捕获" : "未捕获"}` : "",
    nestedDiagnosis.root_cause ? `诊断：${String(nestedDiagnosis.root_cause)}` : ""
  ].filter(Boolean);
  return pieces.join(" ") || "工具未返回明确摘要，可展开查看原始记录。";
}

function summarizeToolCorrection(tool: ToolCallView) {
  const result = asRecord(tool.result);
  const diagnosis = asRecord(result.diagnosis);
  if (diagnosis.next_step) return String(diagnosis.next_step);
  if (result.next_step) return String(result.next_step);
  if (tool.success === false) return "本次工具失败，需要根据错误日志、参数和硬件状态继续修正。";
  if (tool.success === true) return "本次工具通过，可进入下一轮观测或最终验收。";
  return "等待后续步骤给出明确结论。";
}

function inferStepReason(step: ClosedLoopStep) {
  const name = String(step.name || "").toLowerCase();
  if (name.includes("compile")) return "验证生成源码和 PlatformIO 配置能否成功构建。";
  if (name.includes("upload") || name.includes("flash")) return "将构建产物烧录到目标 ESP 开发板。";
  if (name.includes("monitor") || name.includes("serial")) return "读取串口日志，观察固件运行状态和验收证据。";
  if (name.includes("diagnos")) return "根据错误日志和运行现象定位失败原因。";
  if (name.includes("gpio") || name.includes("preflight")) return "检查板卡、串口、GPIO 或硬件连接风险。";
  return "执行闭环流程中的一个阶段。";
}

function MemoryPanel({
  loading,
  memory,
  onClear,
  onExport,
  onRefresh,
  status
}: {
  loading: boolean;
  memory: MemoryApiState | null;
  onClear: () => void;
  onExport: () => void;
  onRefresh: () => void;
  status: string;
}) {
  const state = memory?.state;
  const recentTurns = memory?.recent_turns || [];
  const facts = state?.project_facts?.length ? state.project_facts : memory?.project_facts?.facts || [];
  return (
    <section className="panel detailCard memoryPanel">
      <div className="panelHead">
        <h2><HardDrive size={18} /> 长期记忆</h2>
        <div className="rowActions">
          <button className="miniButton" type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCcw size={14} />
            刷新
          </button>
          <button className="miniButton" type="button" onClick={onExport} disabled={loading || !memory}>
            <Download size={14} />
            导出
          </button>
          <button className="miniButton danger" type="button" onClick={onClear} disabled={loading}>
            清除
          </button>
        </div>
      </div>
      {status && <p className="muted">{status}</p>}
      {!state ? (
        <p className="muted">记忆状态尚未加载。</p>
      ) : (
        <div className="memoryGrid">
          <article className="memoryCard wide">
            <span>长期摘要</span>
            <p>{state.long_term_summary || "暂无长期摘要。对话完成后会自动生成提取式摘要。"}</p>
          </article>
          <article className="memoryCard">
            <span>短期上下文</span>
            <strong>{state.short_term_context?.length || 0}</strong>
            <small>最近消息数量</small>
          </article>
          <article className="memoryCard">
            <span>最近轮次</span>
            <strong>{recentTurns.length}</strong>
            <small>conversation_log.jsonl</small>
          </article>
          <article className="memoryCard wide">
            <span>硬件状态</span>
            <pre>{safeJson(state.hardware_state || {})}</pre>
          </article>
          <article className="memoryCard wide">
            <span>项目事实</span>
            {facts.length === 0 ? (
              <p>暂无项目事实。</p>
            ) : (
              <ul>
                {facts.map((fact, index) => <li key={`${fact}-${index}`}>{fact}</li>)}
              </ul>
            )}
          </article>
          <article className="memoryCard wide">
            <span>最近对话</span>
            {recentTurns.length === 0 ? (
              <p>暂无已持久化对话。</p>
            ) : (
              <div className="memoryTurns">
                {recentTurns.slice(-8).reverse().map((turn) => (
                  <div className="memoryTurn" key={turn.id}>
                    <strong>{formatDateTime(turn.created_at)}</strong>
                    <small>{turn.tags?.join(", ") || "conversation"}</small>
                    {turn.messages.slice(0, 3).map((message, index) => (
                      <p key={`${turn.id}-${index}`}><b>{message.role}</b>：{message.content}</p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function SkillMcpPanel({
  compact = false,
  loading,
  mcps,
  onToggle,
  skills,
  status
}: {
  compact?: boolean;
  loading: boolean;
  mcps: CapabilityDefinition[];
  onToggle: (kind: "skill" | "mcp", name: string, enabled: boolean) => void;
  skills: CapabilityDefinition[];
  status: string;
}) {
  const enabledSkills = skills.filter((item) => item.enabled).length;
  const enabledMcps = mcps.filter((item) => item.enabled).length;
  return (
    <div className={compact ? "capabilityPanel compact" : "capabilityPanel"}>
      <div className="panelHead">
        <div>
          <strong>Skill / MCP 能力注册表</strong>
          <p className="muted">已启用能力可在 Chat 输入框通过 `/` 选择，也可由智能体根据任务自动调用。</p>
        </div>
      </div>
      <div className="capabilityHint">
        <span>Skill：{enabledSkills}/{skills.length} 已启用</span>
        <span>MCP：{enabledMcps}/{mcps.length} 已启用</span>
        <span>调用方式：`/能力名 参数`</span>
      </div>
      {status && <p className="knowledgeStatus">{status}</p>}
      <div className="capabilityDropdowns">
        <details className="capabilityDropdown" open>
          <summary>
            <span>Skills</span>
            <small>{enabledSkills}/{skills.length} 已启用</small>
          </summary>
          {skills.length === 0 ? (
            <p className="muted">暂无 Skill。</p>
          ) : (
            <div className="capabilityList">
              {skills.map((skill) => (
                <CapabilityCard
                  item={skill}
                  key={skill.name}
                  kind="skill"
                  loading={loading}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </details>
        <details className="capabilityDropdown">
          <summary>
            <span>MCP</span>
            <small>{enabledMcps}/{mcps.length} 已启用</small>
          </summary>
          {mcps.length === 0 ? (
            <p className="muted">暂无 MCP。</p>
          ) : (
            <div className="capabilityList">
              {mcps.map((mcp) => (
                <CapabilityCard
                  item={mcp}
                  key={mcp.name}
                  kind="mcp"
                  loading={loading}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </details>
      </div>
    </div>
  );
}

function CapabilityCard({
  item,
  kind,
  loading,
  onToggle
}: {
  item: CapabilityDefinition;
  kind: "skill" | "mcp";
  loading: boolean;
  onToggle: (kind: "skill" | "mcp", name: string, enabled: boolean) => void;
}) {
  const details = item.inputs?.length
    ? `输入：${item.inputs.join(", ")}`
    : item.capabilities?.length
      ? `能力：${item.capabilities.join(", ")}`
      : "";
  return (
    <details className={item.enabled ? "capabilityCard enabled" : "capabilityCard"}>
      <summary className="capabilityCardHead">
        <div>
          <strong>{item.title || item.name}</strong>
          <span>{item.invocation || `/${item.name}`} · {item.category || "general"} · {item.stage}</span>
        </div>
        <span className={item.enabled ? "capabilityState on" : "capabilityState"}>
          {kind.toUpperCase()} · {item.enabled ? "ON" : "OFF"}
        </span>
      </summary>
      <div className="capabilityCardBody">
        <p>{item.description}</p>
        {details && <small>{details}</small>}
        {item.outputs?.length ? <small>输出：{item.outputs.join(", ")}</small> : null}
        {item.examples?.length ? <small>示例：{item.examples.join("；")}</small> : null}
        <label className="switchLine">
          <input
            checked={item.enabled}
            disabled={loading}
            type="checkbox"
            onChange={(event) => onToggle(kind, item.name, event.target.checked)}
          />
          <span>{item.enabled ? "已启用" : "已禁用"}</span>
        </label>
      </div>
    </details>
  );
}

function extractKnowledgeCitations(tool: ToolCallView): KnowledgeCitationView[] {
  const result = tool.result;
  if (!result || typeof result !== "object") return [];
  const citations = (result as { citations?: unknown }).citations;
  if (!Array.isArray(citations)) return [];
  return citations
    .map((item) => item && typeof item === "object" ? item as KnowledgeCitationView : null)
    .filter((item): item is KnowledgeCitationView => Boolean(item));
}

function toolTypeLabel(tool: ToolCallView) {
  const name = String(tool.name || "");
  if (name === "skill_invocation") return "Skill";
  if (name === "mcp_invocation") return "MCP";
  if (name === "rag_knowledge_search") return "RAG";
  if (name.includes("compile") || name.includes("firmware") || name.includes("esp_")) return "ESP Tool";
  return "Tool";
}

function toolDisplayName(tool: ToolCallView) {
  const result = asRecord(tool.result);
  const args = asRecord(tool.args);
  const capability = asRecord(result.capability);
  const fromCapability = stringValue(capability.name || capability.title);
  if (fromCapability) return fromCapability;
  const command = stringValue(args.command);
  if (command) return `/${command}`;
  return String(tool.name || "unknown_tool");
}

function summarizeToolCall(tool: ToolCallView): ToolCallSummaryItem[] {
  const result = asRecord(tool.result);
  const args = asRecord(tool.args);
  const name = String(tool.name || "");
  if (name === "skill_invocation") return summarizeSkillInvocation(result, args);
  if (name === "mcp_invocation") return summarizeMcpInvocation(result, args);
  if (name === "rag_knowledge_search") return summarizeRagSearch(result, args);
  if (name.includes("compile") || name.includes("firmware") || name.includes("esp_")) return summarizeEspTool(result, args);
  return summarizeGenericTool(result, args);
}

function summarizeSkillInvocation(result: Record<string, unknown>, args: Record<string, unknown>) {
  const items: ToolCallSummaryItem[] = [];
  const capability = asRecord(result.capability);
  addSummaryItem(items, "调用", stringValue(capability.invocation) || slashCommand(args));
  addSummaryItem(items, "板卡", stringValue(result.board_name || result.board_model));
  const findings = asArray(result.findings);
  if (findings.length > 0) {
    addSummaryItem(items, "检查引脚", String(findings.length));
    addSummaryItem(items, "高风险", String(findings.filter((item) => asRecord(item).status === "avoid").length));
  }
  const peripherals = asArray(result.matched_peripherals);
  if (peripherals.length > 0) addSummaryItem(items, "外设配置", String(peripherals.length));
  addSummaryItem(items, "下一步", stringValue(result.next_step));
  return items;
}

function summarizeMcpInvocation(result: Record<string, unknown>, args: Record<string, unknown>) {
  const mode = stringValue(result.mode);
  if (mode === "list_ports" || mode === "probe_port") return summarizeSerialMcp(result, args);
  if (mode === "knowledge_summary" || mode === "source_summary" || mode === "memory_summary" || mode === "project_overview") return summarizeFilesystemMcp(result, args);
  if (mode === "status_summary") return summarizeGitMcp(result, args);
  if (mode === "project_analysis") return summarizeProjectAnalysisMcp(result, args);
  const items = summarizeGenericTool(result, args);
  addSummaryItem(items, "模式", mode);
  return items;
}

function summarizeSerialMcp(result: Record<string, unknown>, args: Record<string, unknown>) {
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "调用", slashCommand(args));
  addSummaryItem(items, "模式", stringValue(result.mode));
  addSummaryItem(items, "选中端口", stringValue(result.selected_port));
  addSummaryItem(items, "波特率", stringValue(result.baud));
  const portsResult = asRecord(result.ports_result);
  const ports = asArray(portsResult.ports || portsResult.items || portsResult.available_ports);
  if (ports.length > 0) addSummaryItem(items, "发现串口", String(ports.length));
  addSummaryItem(items, "下一步", stringValue(result.next_step));
  return items;
}

function summarizeFilesystemMcp(result: Record<string, unknown>, args: Record<string, unknown>) {
  const counts = asRecord(result.counts);
  const roots = asArray(result.roots);
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "调用", slashCommand(args));
  addSummaryItem(items, "范围", stringValue(result.mode));
  addSummaryItem(items, "根目录", roots.length ? String(roots.length) : "");
  addSummaryItem(items, "文件", stringValue(counts.files));
  addSummaryItem(items, "目录", stringValue(counts.directories));
  addSummaryItem(items, "下一步", stringValue(result.next_step));
  return items;
}

function summarizeGitMcp(result: Record<string, unknown>, args: Record<string, unknown>) {
  const counts = asRecord(result.counts);
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "调用", slashCommand(args));
  addSummaryItem(items, "分支", stringValue(result.branch));
  addSummaryItem(items, "改动", stringValue(counts.total));
  addSummaryItem(items, "未跟踪", stringValue(counts.untracked));
  addSummaryItem(items, "ahead/behind", `${stringValue(result.ahead) || "0"}/${stringValue(result.behind) || "0"}`);
  addSummaryItem(items, "状态", result.is_dirty ? "有未提交改动" : "工作区干净");
  return items;
}

function summarizeProjectAnalysisMcp(result: Record<string, unknown>, args: Record<string, unknown>) {
  const packageInfo = asRecord(result.package_info);
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "调用", slashCommand(args));
  addSummaryItem(items, "项目", stringValue(packageInfo.name));
  addSummaryItem(items, "目录", String(asArray(result.directories).length || ""));
  addSummaryItem(items, "文档", String(asArray(result.documents).length || ""));
  addSummaryItem(items, "配置", String(asArray(result.config_files).length || ""));
  addSummaryItem(items, "风险", String(asArray(result.risks).length || ""));
  return items;
}

function summarizeRagSearch(result: Record<string, unknown>, args: Record<string, unknown>) {
  const citations = asArray(result.citations);
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "查询", stringValue(args.query || result.query));
  addSummaryItem(items, "命中片段", citations.length ? String(citations.length) : stringValue(result.count));
  return items;
}

function summarizeEspTool(result: Record<string, unknown>, args: Record<string, unknown>) {
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "项目", stringValue(args.project_name || result.project_name));
  addSummaryItem(items, "板卡", stringValue(args.board_model || result.board_model));
  addSummaryItem(items, "端口", stringValue(args.port || result.port));
  addSummaryItem(items, "结果", stringValue(result.summary || result.status));
  return items;
}

function summarizeGenericTool(result: Record<string, unknown>, args: Record<string, unknown>) {
  const items: ToolCallSummaryItem[] = [];
  addSummaryItem(items, "调用", slashCommand(args));
  addSummaryItem(items, "结果", stringValue(result.summary));
  addSummaryItem(items, "下一步", stringValue(result.next_step));
  return items;
}

function addSummaryItem(items: ToolCallSummaryItem[], label: string, value: unknown) {
  const normalized = stringValue(value);
  if (!normalized) return;
  items.push({ label, value: truncateText(normalized, label === "下一步" ? 90 : 44) });
}

function slashCommand(args: Record<string, unknown>) {
  const command = stringValue(args.command);
  const query = stringValue(args.query);
  if (!command) return "";
  return query ? `/${command} ${query}` : `/${command}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function truncateText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function ToolCallDetails({ tool }: { tool: ToolCallView }) {
  const detail = pickToolDetail(tool);
  if (!detail) return null;
  return (
    <details className="toolDetails">
      <summary>查看完整工具结果</summary>
      <pre>{safeJson(detail)}</pre>
    </details>
  );
}

function pickToolDetail(tool: ToolCallView) {
  const record = tool as Record<string, unknown>;
  const detail: Record<string, unknown> = {};
  for (const key of ["args", "result", "input", "output"]) {
    if (record[key] !== undefined) detail[key] = record[key];
  }
  return Object.keys(detail).length ? detail : null;
}

function safeJson(value: unknown) {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }, 2);
  } catch (error) {
    return `无法展示工具详情：${error instanceof Error ? error.message : String(error)}`;
  }
}

function commonModels(provider: string) {
  const key = provider.toLowerCase();
  if (key.includes("deepseek")) return ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"];
  if (key.includes("qwen")) return ["qwen-plus", "qwen-max", "qwen-turbo"];
  if (key.includes("ollama")) return ["qwen2.5-coder:7b", "llama3.1:8b"];
  if (key.includes("openai")) return ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
  return ["deepseek-chat", "qwen-plus", "gpt-4o-mini"];
}

function ModelSettings({ settings, onChange }: { settings: LlmSettings; onChange: (value: LlmSettings) => void }) {
  const [models, setModels] = useState<string[]>(settings.model ? [settings.model] : []);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");

  async function fetchModels() {
    setLoadingModels(true);
    setModelError("");
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: settings.baseUrl, apiKey: settings.apiKey })
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "获取模型列表失败");
      const nextModels = Array.isArray(data.models) ? data.models.map(String).filter(Boolean) : [];
      setModels(nextModels);
      if (!settings.model && nextModels[0]) onChange({ ...settings, enabled: true, model: nextModels[0] });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  }

  function update(next: Partial<LlmSettings>) {
    onChange({ ...settings, ...next, enabled: true });
  }

  function updateNumber(key: keyof LlmSettings, value: string, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    update({ [key]: Math.min(max, Math.max(min, Math.trunc(parsed))) } as Partial<LlmSettings>);
  }

  const modelOptions = [...new Set([settings.model, ...commonModels(settings.provider), ...models].filter(Boolean))];

  return (
    <div className="llmSettings noBorder">
      <label>
        Provider
        <select value={settings.provider} onChange={(event) => update({ provider: event.target.value })}>
          <option value="deepseek">DeepSeek</option>
          <option value="qwen">Qwen / DashScope</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="openai-compatible">OpenAI-compatible</option>
        </select>
      </label>
      <label>Base URL<input placeholder="https://api.deepseek.com" value={settings.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label>
      <label>API Key<input placeholder="sk-..." type="password" value={settings.apiKey} onChange={(event) => update({ apiKey: event.target.value })} /></label>
      <div className="modelSelectRow">
        <label>
          Model
          <select value={settings.model} onChange={(event) => update({ model: event.target.value })}>
            <option value="">选择模型</option>
            {modelOptions.map((model) => <option value={model} key={model}>{model}</option>)}
          </select>
        </label>
        <button className="ghost compactButton" type="button" disabled={loadingModels || !settings.baseUrl.trim()} onClick={fetchModels}>
          {loadingModels ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
          获取模型
        </button>
      </div>
      <div className="runtimeSettings">
        <strong>执行参数</strong>
        <div className="runtimeGrid">
          <label>
            模型单次超时
            <div className="unitInput">
              <input type="number" min={30} max={600} value={Math.round(settings.modelTimeoutMs / 1000)} onChange={(event) => updateNumber("modelTimeoutMs", String(Number(event.target.value) * 1000), 30_000, 600_000)} />
              <span>秒</span>
            </div>
          </label>
          <label>
            ReAct 最大轮数
            <div className="unitInput">
              <input type="number" min={1} max={20} value={settings.recursionLimit} onChange={(event) => updateNumber("recursionLimit", event.target.value, 1, 20)} />
              <span>轮</span>
            </div>
          </label>
          <label>
            编译超时
            <div className="unitInput">
              <input type="number" min={60} max={1800} value={settings.compileTimeoutSec} onChange={(event) => updateNumber("compileTimeoutSec", event.target.value, 60, 1800)} />
              <span>秒</span>
            </div>
          </label>
          <label>
            烧录超时
            <div className="unitInput">
              <input type="number" min={30} max={600} value={settings.uploadTimeoutSec} onChange={(event) => updateNumber("uploadTimeoutSec", event.target.value, 30, 600)} />
              <span>秒</span>
            </div>
          </label>
          <label>
            串口读取
            <div className="unitInput">
              <input type="number" min={1} max={120} value={settings.monitorSeconds} onChange={(event) => updateNumber("monitorSeconds", event.target.value, 1, 120)} />
              <span>秒</span>
            </div>
          </label>
        </div>
      </div>
      {modelError && <p className="badText">{modelError}</p>}
    </div>
  );
}

function SerialPortSelector({
  form,
  onChange,
  onProbe,
  onRefresh,
  ports,
  portsMessage,
  probeResult,
  probing
}: {
  form: ConsoleForm;
  onChange: (value: ConsoleForm) => void;
  onProbe: () => void;
  onRefresh: () => void;
  ports: SerialPortInfo[];
  portsMessage: string;
  probeResult: Record<string, unknown> | null;
  probing: boolean;
}) {
  const selectedPort = form.port.trim();
  const selectedInfo = ports.find((port) => port.device === selectedPort);
  return (
    <section className="serialSelectBox">
      <div className="serialHead">
        <strong>串口</strong>
        <span className={selectedPort ? "serialState on" : "serialState"}>{selectedPort ? `已选择 ${selectedPort}` : "未选择"}</span>
      </div>
      <div className="serialControls">
        <select value={selectedPort} onChange={(event) => onChange({ ...form, port: event.target.value })}>
          <option value="">不烧录，仅生成和编译</option>
          {ports.map((port) => (
            <option value={port.device} key={port.device}>
              {port.device} · {port.is_usb_candidate ? "USB候选" : port.is_bluetooth ? "蓝牙" : cleanPortText(port.description || port.manufacturer || port.hwid)}
            </option>
          ))}
        </select>
        <button className="ghost compactButton" type="button" onClick={onRefresh}>
          <RefreshCcw size={15} />
          刷新
        </button>
        <button className="ghost compactButton" type="button" disabled={probing || !selectedPort} onClick={onProbe}>
          {probing ? <Loader2 className="spin" size={15} /> : <Terminal size={15} />}
          开启探测
        </button>
      </div>
      <p className="serialHint">{selectedInfo ? cleanPortText(selectedInfo.description || selectedInfo.manufacturer || selectedInfo.hwid) : portsMessage}</p>
      {probeResult && (
        <span className={probeResult.success ? "probeOk" : "probeBad"}>
          {probeResult.success ? "开启状态：可打开" : "开启状态：不可打开"} · {String(probeResult.message || probeResult.error_type || "")}
        </span>
      )}
    </section>
  );
}

function BoardPinMapView({
  board,
  form,
  peripherals,
  onPeripheralsChange,
  onChange
}: {
  board: BoardPinMap;
  form: ConsoleForm;
  peripherals: PeripheralConfig[];
  onPeripheralsChange: (value: PeripheralConfig[]) => void;
  onChange: (value: ConsoleForm) => void;
}) {
  const pins = buildVisualPins(board);
  const configuredPins = getConfiguredPeripheralPins(peripherals);
  const [target, setTarget] = useState<PinTarget>("sda_pin");
  const [assignmentMessage, setAssignmentMessage] = useState("");

  function assignPin(pinLabel: string) {
    const gpio = Number(pinLabel.replace("GPIO", ""));
    if (!Number.isInteger(gpio)) return;
    const result = assignPeripheralPin(peripherals, target, gpio);
    if (result.updated) {
      onPeripheralsChange(result.peripherals);
      setAssignmentMessage(`已把 ${pinLabel} 写入 ${result.label}，请点击“保存外设配置”同步到当前硬件状态。`);
      return;
    }
    if (result.reason) {
      setAssignmentMessage(result.reason);
      return;
    }
    onChange({ ...form, [target]: gpio });
    setAssignmentMessage(`已选择 ${pinLabel} 作为 ${pinTargetLabel(target)}。`);
  }

  return (
    <section className="pinMapBox">
      <div className="pinMapHead">
        <strong>{board.title}</strong>
        <label className="pinTargetSelect">
          连接到
          <select value={target} onChange={(event) => setTarget(event.target.value as PinTarget)}>
            <option value="sda_pin">I2C SDA</option>
            <option value="scl_pin">I2C SCL</option>
            <option value="oled_clk_pin">OLED CLK/SCL</option>
            <option value="oled_mosi_pin">OLED MOSI/SDA</option>
            <option value="oled_reset_pin">OLED RES</option>
            <option value="oled_dc_pin">OLED DC</option>
            <option value="led_pin">LED</option>
            <option value="buzzer_pin">蜂鸣器</option>
          </select>
        </label>
      </div>
      <div className="boardVisual" aria-label={`${board.title} 图片式引脚功能图`}>
        <div className="pinColumn">
          {pins.left.map((pin) => <PinChip pin={pin} key={pin.label} onClick={() => assignPin(pin.label)} />)}
        </div>
        <div className="boardBody">
          <Cpu size={28} />
          <strong>{board.boardModel}</strong>
          <span>USB</span>
        </div>
        <div className="pinColumn">
          {pins.right.map((pin) => <PinChip pin={pin} key={pin.label} onClick={() => assignPin(pin.label)} />)}
        </div>
      </div>
      <div className="pinMapDefaults">
        {configuredPins.length > 0 ? configuredPins.map((item) => (
          <span key={`${item.name}-${item.pinKey}`}>{item.name} {item.label}: {item.gpio >= 0 ? `GPIO${item.gpio}` : "未配置"}</span>
        )) : <span>暂无已保存外设引脚，请先在外设配置中添加并保存。</span>}
      </div>
      {assignmentMessage && <p className="pinAssignNotice">{assignmentMessage}</p>}
    </section>
  );
}

type PinTarget = "sda_pin" | "scl_pin" | "oled_clk_pin" | "oled_mosi_pin" | "oled_reset_pin" | "oled_dc_pin" | "led_pin" | "buzzer_pin";

function pinTargetLabel(target: PinTarget) {
  const labels: Record<PinTarget, string> = {
    sda_pin: "I2C SDA",
    scl_pin: "I2C SCL",
    oled_clk_pin: "OLED CLK/SCL",
    oled_mosi_pin: "OLED MOSI/SDA",
    oled_reset_pin: "OLED RES",
    oled_dc_pin: "OLED DC",
    led_pin: "LED",
    buzzer_pin: "蜂鸣器"
  };
  return labels[target];
}

function assignPeripheralPin(peripherals: PeripheralConfig[], target: PinTarget, gpio: number) {
  const map: Partial<Record<PinTarget, { templates: string[]; pinKey: string; label: string; missing: string }>> = {
    sda_pin: { templates: ["oled_i2c_4pin", "aht20_i2c", "bh1750_i2c"], pinKey: "sda", label: "I2C SDA", missing: "请先在外设配置中添加 I2C 外设，再选择 SDA 引脚。" },
    scl_pin: { templates: ["oled_i2c_4pin", "aht20_i2c", "bh1750_i2c"], pinKey: "scl", label: "I2C SCL", missing: "请先在外设配置中添加 I2C 外设，再选择 SCL 引脚。" },
    oled_clk_pin: { templates: ["oled_spi_6pin"], pinKey: "clk", label: "OLED CLK/SCL", missing: "请先在外设配置中添加 6pin SPI OLED。" },
    oled_mosi_pin: { templates: ["oled_spi_6pin"], pinKey: "mosi", label: "OLED MOSI/SDA", missing: "请先在外设配置中添加 6pin SPI OLED。" },
    oled_reset_pin: { templates: ["oled_spi_6pin", "oled_i2c_4pin"], pinKey: "res", label: "OLED RES", missing: "请先在外设配置中添加 OLED 外设。" },
    oled_dc_pin: { templates: ["oled_spi_6pin"], pinKey: "dc", label: "OLED DC", missing: "请先在外设配置中添加 6pin SPI OLED。" },
    led_pin: { templates: ["led_gpio"], pinKey: "signal", label: "LED 控制 GPIO", missing: "请先在外设配置中添加外接 LED。" },
    buzzer_pin: { templates: ["passive_buzzer"], pinKey: "signal", label: "蜂鸣器控制 GPIO", missing: "请先在外设配置中添加无源蜂鸣器。" }
  };
  const rule = map[target];
  if (!rule) return { updated: false, peripherals, label: "", reason: "" };
  const index = peripherals.findIndex((item) => item.enabled && rule.templates.includes(item.templateId));
  if (index < 0) return { updated: false, peripherals, label: "", reason: rule.missing };
  const next = peripherals.map((item, itemIndex) => itemIndex === index
    ? { ...item, pins: { ...item.pins, [rule.pinKey]: gpio } }
    : item
  );
  return { updated: true, peripherals: next, label: rule.label, reason: "" };
}

function PinChip({ pin, onClick }: { pin: BoardPinDefinition; onClick?: () => void }) {
  return (
    <button className={`pinChip ${pin.status}`} type="button" onClick={onClick}>
      <span>{pin.label}</span>
      {pin.role && <small>{pin.role}</small>}
      {pin.functions.length > 0 && (
        <em>{pin.functions.slice(0, 4).join(" · ")}</em>
      )}
    </button>
  );
}

function buildVisualPins(board: BoardPinMap) {
  if (board.pins?.length) {
    const midpoint = Math.ceil(board.pins.length / 2);
    return { left: board.pins.slice(0, midpoint), right: board.pins.slice(midpoint) };
  }
  const defaults = new Map(Object.entries(board.defaults).filter(([, value]) => value >= 0).map(([role, value]) => [`GPIO${value}`, role.toUpperCase()]));
  const avoid = new Set(board.avoidPins.map(extractGpioLabel).filter(isString));
  const safe = board.safePins.map((pin) => extractGpioLabel(pin) || pin).filter(isString);
  const all = [...new Set([...safe, ...[...avoid]])].map((label) => ({
    label,
    functions: [],
    role: defaults.get(label),
    status: defaults.has(label) ? "default" as const : avoid.has(label) ? "avoid" as const : "safe" as const
  }));
  const midpoint = Math.ceil(all.length / 2);
  return { left: all.slice(0, midpoint), right: all.slice(midpoint) };
}

function getConfiguredPeripheralPins(peripherals: PeripheralConfig[]) {
  return peripherals
    .filter((item) => item.enabled)
    .flatMap((item) => {
      const template = getPeripheralTemplate(item.templateId);
      if (!template) return [];
      return template.pins.map((pin) => ({
        name: template.name,
        pinKey: pin.key,
        label: pin.label,
        gpio: Number(item.pins?.[pin.key] ?? pin.defaultValue)
      }));
    });
}

function extractGpioLabel(value: string) {
  return value.match(/GPIO\d+/)?.[0];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getPeripheralTemplate(templateId: string) {
  return peripheralTemplates.find((item) => item.id === templateId);
}

function isOledPeripheral(templateId: string) {
  return templateId === "oled_spi_6pin" || templateId === "oled_i2c_4pin";
}

function getOledProtocol(templateId: string): "spi" | "i2c" {
  return templateId === "oled_i2c_4pin" ? "i2c" : "spi";
}

function switchOledProtocol(peripheral: PeripheralConfig, protocol: "spi" | "i2c"): PeripheralConfig {
  const template = getPeripheralTemplate(protocol === "spi" ? "oled_spi_6pin" : "oled_i2c_4pin");
  if (!template) return peripheral;
  const pins = peripheral.pins || {};
  return {
    ...peripheral,
    templateId: template.id,
    name: template.name,
    pins: protocol === "spi"
      ? {
          clk: Number(pins.clk ?? pins.scl ?? -1),
          mosi: Number(pins.mosi ?? pins.sda ?? -1),
          res: Number(pins.res ?? -1),
          dc: Number(pins.dc ?? -1)
        }
      : {
          sda: Number(pins.sda ?? pins.mosi ?? 4),
          scl: Number(pins.scl ?? pins.clk ?? 5),
          res: Number(pins.res ?? -1)
        },
    notes: peripheral.notes
  };
}

function PeripheralEditor({
  peripherals,
  onChange,
  onSave
}: {
  peripherals: PeripheralConfig[];
  onChange: (value: PeripheralConfig[]) => void;
  onSave: () => void;
}) {
  const [savedAt, setSavedAt] = useState("");
  const [newTemplateId, setNewTemplateId] = useState("");
  const [newPeripheralName, setNewPeripheralName] = useState("");
  const [addingPeripheral, setAddingPeripheral] = useState(false);
  const selectedTemplate = getPeripheralTemplate(newTemplateId) || getPeripheralTemplate("generic_gpio") || peripheralTemplates[0];

  function saveNow() {
    onSave();
    setSavedAt(new Date().toLocaleTimeString());
  }

  function addPeripheral(templateId: string, customName = "") {
    const template = peripheralTemplates.find((item) => item.id === templateId) || peripheralTemplates[0];
    const name = customName.trim() || template.name;
    onChange([
      ...peripherals,
      {
        id: `peripheral-${Date.now()}`,
        templateId: template.id,
        name,
        enabled: true,
        pins: Object.fromEntries(template.pins.map((pin) => [pin.key, pin.defaultValue])),
        notes: ""
      }
    ]);
  }

  function addSelectedPeripheral() {
    const fallbackTemplateId = newTemplateId || "generic_gpio";
    addPeripheral(fallbackTemplateId, newPeripheralName);
    setNewTemplateId("");
    setNewPeripheralName("");
    setAddingPeripheral(false);
  }

  function updatePeripheral(id: string, next: Partial<PeripheralConfig>) {
    onChange(peripherals.map((item) => item.id === id ? { ...item, ...next } : item));
  }

  function removePeripheral(id: string) {
    onChange(peripherals.filter((item) => item.id !== id));
  }

  return (
    <section className="peripheralBox">
      <div className="peripheralHead">
        <strong>外设配置</strong>
        <div className="peripheralActions">
          <button className="ghost compactButton" type="button" onClick={() => setAddingPeripheral(true)}>添加常用外设</button>
          <button className="primary compactButton" type="button" onClick={saveNow}>保存外设配置</button>
        </div>
      </div>
      {addingPeripheral && (
        <div className="peripheralModal" role="dialog" aria-modal="true" aria-label="添加常用外设">
          <div className="peripheralModalCard">
            <div className="peripheralModalHead">
              <strong>添加常用外设</strong>
              <button className="ghost compactButton" type="button" onClick={() => setAddingPeripheral(false)}>关闭</button>
            </div>
            <label>
              外设类型
              <select value={newTemplateId} onChange={(event) => {
                const templateId = event.target.value;
                setNewTemplateId(templateId);
                const template = getPeripheralTemplate(templateId);
                setNewPeripheralName((current) => current.trim() ? current : template?.name || "");
              }}>
                <option value="">通用 GPIO 外设</option>
                {peripheralTemplates.map((template) => (
                  <option value={template.id} key={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <label>
              外设名称
              <input
                placeholder="例如 DHT11 温湿度、左侧 LED、SPI OLED"
                value={newPeripheralName}
                onChange={(event) => setNewPeripheralName(event.target.value)}
              />
            </label>
            <div className="peripheralTemplateInfo">
              <span>类型信息</span>
              <strong>{selectedTemplate.name}</strong>
              <small>总线/协议：{selectedTemplate.bus.toUpperCase()}</small>
              <div className="peripheralPinInfo">
                {selectedTemplate.pins.map((pin) => (
                  <p key={pin.key}><b>{pin.label}</b>：{pin.hint}，默认 {pin.defaultValue >= 0 ? `GPIO${pin.defaultValue}` : "未配置"}</p>
                ))}
              </div>
            </div>
            <div className="peripheralModalActions">
              <button className="ghost compactButton" type="button" onClick={() => setAddingPeripheral(false)}>取消</button>
              <button className="primary compactButton" type="button" onClick={addSelectedPeripheral}>确认添加</button>
            </div>
          </div>
        </div>
      )}
      {savedAt && <p className="saveNotice">已保存到当前硬件状态：{savedAt}</p>}
      {peripherals.length === 0 ? (
        <p className="muted">尚未添加外设；添加后会保存到当前硬件状态，并随对话提供给 Embex。</p>
      ) : (
        <div className="peripheralList">
          {peripherals.map((item) => {
            const template = getPeripheralTemplate(item.templateId);
            const displayName = item.name || template?.name || "外设";
            return (
              <article className="peripheralCard" key={item.id}>
                <div className="peripheralCardHead">
                  <label className="inlineCheck">
                    <input
                      checked={item.enabled}
                      type="checkbox"
                      onChange={(event) => event.target.checked ? updatePeripheral(item.id, { enabled: true }) : removePeripheral(item.id)}
                    />
                    {displayName}
                  </label>
                  <button className="ghost compactButton" type="button" onClick={() => removePeripheral(item.id)}>删除</button>
                </div>
                <label>
                  外设名称
                  <input
                    placeholder={template?.name || "自定义外设名称"}
                    value={item.name}
                    onChange={(event) => updatePeripheral(item.id, { name: event.target.value })}
                  />
                </label>
                {isOledPeripheral(item.templateId) && (
                  <label>
                    OLED 通信协议
                    <select
                      value={getOledProtocol(item.templateId)}
                      onChange={(event) => updatePeripheral(item.id, switchOledProtocol(item, event.target.value as "spi" | "i2c"))}
                    >
                      <option value="spi">SPI：SCL/CLK、SDA/MOSI、RES、DC</option>
                      <option value="i2c">I2C：SDA、SCL、RES</option>
                    </select>
                  </label>
                )}
                <div className="pinGrid">
                  {(template?.pins || []).map((pin) => (
                    <NumberField
                      key={pin.key}
                      label={`${pin.label} · ${pin.hint}`}
                      value={Number(item.pins[pin.key] ?? pin.defaultValue)}
                      onChange={(value) => updatePeripheral(item.id, { pins: { ...item.pins, [pin.key]: value } })}
                    />
                  ))}
                </div>
                <label>
                  备注
                  <input
                    placeholder="例如屏幕地址 0x3C、BH1750 地址 0x23"
                    value={item.notes}
                    onChange={(event) => updatePeripheral(item.id, { notes: event.target.value })}
                  />
                </label>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ManualLogBox({
  disabled,
  log,
  onChange,
  onRun
}: {
  disabled: boolean;
  log: string;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <div className="manualLogBox">
      <label>
        粘贴编译/烧录/串口日志
        <textarea
          placeholder="粘贴 PlatformIO、esptool 或串口日志，Embex 会做根因诊断。"
          value={log}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button className="ghost" disabled={disabled} type="button" onClick={onRun}>
        <Terminal size={15} />
        诊断日志
      </button>
    </div>
  );
}

function HardwareChecklist({
  checks,
  hasConfiguredPeripherals,
  hasPort,
  onToggle,
  ports,
  preflight
}: {
  checks: HardwareChecks;
  hasConfiguredPeripherals: boolean;
  hasPort: boolean;
  onToggle: (key: keyof HardwareChecks) => void;
  ports: SerialPortInfo[];
  preflight: PreflightResult | null;
}) {
  const hasUsbCandidate = ports.some((port) => port.is_usb_candidate);
  const hasPnpCandidate = ports.some((port) => port.source === "windows_pnp")
    || Boolean(preflight?.windows_pnp_usb_uart_candidates?.length)
    || Boolean(preflight?.windows_pnp_serial_probe_results?.length);
  const openablePnpPorts = preflight?.openable_pnp_ports ?? [];
  const pnpProbeFailures = preflight?.windows_pnp_serial_probe_results?.filter((item) => item.success === false) ?? [];
  const hasOpenablePnp = openablePnpPorts.length > 0;
  const items = [
    { label: "Conda/PlatformIO 环境就绪", done: true, locked: true },
    { label: "检测到 USB-UART 候选串口", done: hasUsbCandidate, locked: true },
    { label: hasPnpCandidate ? "PnP 候选需通过 pyserial 打开" : "等待 Windows PnP 候选串口", done: hasOpenablePnp, locked: true },
    { label: "已选择烧录串口", done: hasPort, locked: true },
    { label: "已按实际硬件添加外设配置", done: hasConfiguredPeripherals, locked: true },
    { label: "确认已保存外设引脚与实物接线一致", done: checks.i2cSharedBus, key: "i2cSharedBus" as const },
    { label: "确认输出类 GPIO 未接到启动/Flash/USB 占用脚", done: checks.outputGpios, key: "outputGpios" as const },
    { label: "确认外设供电电压与模块要求一致", done: checks.oledPower, key: "oledPower" as const },
    { label: "确认所有模块 GND 共地", done: checks.commonGround, key: "commonGround" as const }
  ];
  return (
    <div className="checklist">
      <strong>硬件联调检查</strong>
      {items.map((item) => (
        <button
          className={item.done ? "check done checkButton" : "check checkButton"}
          disabled={item.locked}
          key={item.label}
          onClick={() => item.key && onToggle(item.key)}
          type="button"
        >
          <CheckCircle2 size={14} />
          <span>{item.label}</span>
        </button>
      ))}
      {hasOpenablePnp && <p className="checkHint">可打开串口：{openablePnpPorts.join(", ")}</p>}
      {!hasOpenablePnp && pnpProbeFailures.length > 0 && (
        <div className="probeFailures">
          {pnpProbeFailures.map((item) => (
            <p key={item.port || item.message}>
              {item.port || "PnP候选"}：{item.error_type || "SerialError"} · {item.message || "串口无法打开"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}


function GoalProgress({ result, hasPort }: { result: ClosedLoopResult | null; hasPort: boolean }) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const completed = new Set(steps.filter((step) => step?.result?.success === true).map((step) => step.name));
  const skippedFlash = steps.some((step) => step?.name === "flash" && step?.result?.success === null);
  const items = [
    { label: "生成工程", done: completed.has("generate_project") },
    { label: "PlatformIO 编译", done: completed.has("compile") },
    { label: "烧录开发板", done: completed.has("flash"), pending: !hasPort || skippedFlash },
    { label: "串口回传", done: completed.has("monitor"), pending: !hasPort || skippedFlash },
    { label: "诊断报告", done: Boolean(result?.diagnosis) }
  ];
  return (
    <div className="goalProgress">
      {items.map((item) => (
        <div className={item.done ? "goal done" : item.pending ? "goal pending" : "goal"} key={item.label}>
          <CheckCircle2 size={15} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function EnvStatus({ environment }: { environment: Record<string, unknown> | null }) {
  if (!environment) {
    return <div className="env">环境检查中...</div>;
  }
  const pioOk = Boolean(environment.pio_ok);
  return (
    <div className={pioOk ? "env okEnv" : "env badEnv"}>
      <strong>{pioOk ? "环境就绪" : "环境待处理"}</strong>
      <span>Python: {String(environment.python || environment.error || "unknown")}</span>
      <span>PIO: {String(environment.pio || environment.pio_error || "unknown")}</span>
      <span>pyserial: {String(environment.pyserial || environment.pyserial_error || "unknown")}</span>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="empty">
      {loading ? <Loader2 className="spin" size={24} /> : <Terminal size={24} />}
      <p>{loading ? "正在调用 ESP 工具..." : "填写端口和 GPIO 后运行；端口留空可先验证生成与编译。"}</p>
    </div>
  );
}

function StepView({ step }: { step: ClosedLoopStep }) {
  const stepResult = step.result || {};
  const status = stepResult.success;
  return (
    <article className="step">
      <div className="stepHead">
        {status === false ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
        <strong>{step.name}</strong>
        <span className={status === false ? "badge bad" : status === null ? "badge skip" : "badge ok"}>
          {status === false ? "failed" : status === null ? "skipped" : "ok"}
        </span>
      </div>
      <p>{stepResult.summary || stepResult.next_step || "Step completed."}</p>
      {stepResult.command && <code>{stepResult.command}</code>}
      {stepResult.project_dir && <code>{stepResult.project_dir}</code>}
      {stepResult.findings && stepResult.findings.length > 0 && (
        <div className="stepFindings">
          {stepResult.findings.map((finding, index) => (
            <p key={`${finding.kind}-${index}`}>
              <strong>{finding.severity || "info"}</strong>
              {finding.role ? ` · ${finding.role}` : ""}
              {finding.gpio ? ` · GPIO${finding.gpio}` : ""}
              {finding.message ? ` · ${finding.message}` : ""}
            </p>
          ))}
        </div>
      )}
      {stepResult.checks && stepResult.checks.length > 0 && (
        <div className="observationList">
          <strong>验收证据 {stepResult.passed ?? 0}/{stepResult.total ?? stepResult.checks.length}</strong>
          {stepResult.checks.map((item) => (
            <div className={item.passed ? "observationItem done" : "observationItem missing"} key={item.key}>
              <CheckCircle2 size={14} />
              <span>{item.label}</span>
              <small>{item.passed ? item.evidence_required : item.action}</small>
            </div>
          ))}
        </div>
      )}
      {stepResult.log && <ExpandableLog log={stepResult.log} />}
    </article>
  );
}

function ExpandableLog({ log }: { log: string }) {
  const preview = compactLog(log);
  const fullLineCount = log.split(/\r?\n/).filter(Boolean).length;
  return (
    <div className="logDetails">
      <pre>{preview}</pre>
      <details>
        <summary>展开完整日志（{fullLineCount} 行）</summary>
        <pre>{log}</pre>
      </details>
    </div>
  );
}

function DiagnosisView({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <div className="report">
      <div className="metric">
        <span>根因</span>
        <strong>{diagnosis.root_cause}</strong>
      </div>
      <div className="metric">
        <span>置信度</span>
        <strong>{Math.round(diagnosis.confidence * 100)}%</strong>
      </div>
      <p className="next">{diagnosis.next_step}</p>
      <div className="findings">
        {diagnosis.findings.map((finding, index) => (
          <div className="finding" key={`${finding.kind}-${index}`}>
            <span className={`dot ${finding.severity}`} />
            <div>
              <strong>{finding.kind}</strong>
              <p>{finding.evidence}</p>
              <p>{finding.action}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function compactLog(log: string) {
  const lines = log.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - 12)).join("\n");
}

function formatElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value?: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function cleanPortText(value?: string) {
  const text = String(value || "Serial device").trim();
  return /\uFFFD/.test(text) ? "Serial device" : text;
}

function loadSavedState(): { form: ConsoleForm; hardwareChecks: HardwareChecks; peripherals: PeripheralConfig[] } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { form: defaults, hardwareChecks: hardwareCheckDefaults, peripherals: [] };
    const parsed = JSON.parse(raw) as Partial<{ form: Partial<ConsoleForm>; hardwareChecks: Partial<HardwareChecks>; peripherals: unknown }>;
    const peripherals = activePeripherals(normalizeSavedPeripherals(parsed.peripherals));
    const form = applyPeripheralsToForm(resetPeripheralPins({ ...defaults, ...parsed.form }), peripherals);
    return {
      form,
      hardwareChecks: { ...hardwareCheckDefaults, ...parsed.hardwareChecks },
      peripherals
    };
  } catch {
    return { form: defaults, hardwareChecks: hardwareCheckDefaults, peripherals: [] };
  }
}

function saveState(form: ConsoleForm, hardwareChecks: HardwareChecks, peripherals: PeripheralConfig[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ form, hardwareChecks, peripherals }));
  } catch {
    // Ignore storage failures; the live form still works.
  }
}

function normalizeSavedPeripherals(value: unknown): PeripheralConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? item as Partial<PeripheralConfig> : null)
    .filter(Boolean)
    .map((item) => {
      const notes = String(item?.notes || "");
      const rawName = String(item?.name || "");
      const templateId = normalizePeripheralTemplateId(String(item?.templateId || ""), rawName, notes);
      const template = getPeripheralTemplate(templateId);
      const savedPins = item?.pins && typeof item.pins === "object" ? item.pins as Record<string, number> : {};
      const defaultPins = template ? Object.fromEntries(template.pins.map((pin) => [pin.key, pin.defaultValue])) : {};
      return {
        id: String(item?.id || `peripheral-${Date.now()}`),
        templateId,
        name: template?.name || rawName || "通用 GPIO 外设",
        enabled: item?.enabled !== false,
        pins: { ...defaultPins, ...savedPins },
        notes
      };
    })
    .filter((item) => item.enabled && hasConfiguredPeripheralPin(item));
}

function activePeripherals(peripherals: PeripheralConfig[]) {
  return peripherals.filter((item) => item.enabled && hasConfiguredPeripheralPin(item));
}

function hasConfiguredPeripheralPin(peripheral: PeripheralConfig) {
  const template = getPeripheralTemplate(peripheral.templateId);
  if (!template) return false;
  return template.pins.some((pin) => Number(peripheral.pins?.[pin.key] ?? pin.defaultValue) >= 0);
}

function normalizePeripheralTemplateId(templateId: string, name: string, notes: string) {
  if (getPeripheralTemplate(templateId)) return templateId;
  const text = `${name} ${notes}`.toLowerCase();
  if (text.includes("oled") && text.includes("spi")) return "oled_spi_6pin";
  if (text.includes("oled") && text.includes("i2c")) return "oled_i2c_4pin";
  if (text.includes("oled")) return "oled_spi_6pin";
  if (text.includes("aht20")) return "aht20_i2c";
  if (text.includes("bh1750")) return "bh1750_i2c";
  if (text.includes("buzzer") || text.includes("蜂鸣")) return "passive_buzzer";
  if (text.includes("led")) return "led_gpio";
  return "generic_gpio";
}

function loadConversationTurns(): ConversationTurn[] {
  try {
    const raw = window.localStorage.getItem(conversationStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => item && typeof item === "object" ? item as Partial<ConversationTurn> : null)
      .filter(Boolean)
      .map((item) => ({
        id: String(item?.id || `turn-${Date.now()}`),
        user: String(item?.user || ""),
        assistant: String(item?.assistant || ""),
        planner: item?.planner,
        toolCalls: Array.isArray(item?.toolCalls) ? item.toolCalls : [],
        result: item?.result,
        progress: item?.progress
      }))
      .filter((item) => item.user || item.assistant)
      .slice(-40);
  } catch {
    return [];
  }
}

function saveConversationTurns(turns: ConversationTurn[]) {
  try {
    window.localStorage.setItem(conversationStorageKey, JSON.stringify(turns.slice(-40)));
  } catch {
    // Ignore storage failures; the live conversation still works.
  }
}

function clearConversationTurns() {
  try {
    window.localStorage.removeItem(conversationStorageKey);
  } catch {
    // Ignore storage failures; the live conversation was already cleared.
  }
}

function loadActiveChatRequest(): ActiveChatRequest | null {
  try {
    const raw = window.localStorage.getItem(activeChatRequestStorageKey)
      || window.localStorage.getItem(legacyActiveChatRequestStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveChatRequest>;
    if (!parsed.requestId || !parsed.turnId) return null;
    return {
      requestId: String(parsed.requestId),
      turnId: String(parsed.turnId),
      startedAt: String(parsed.startedAt || "")
    };
  } catch {
    return null;
  }
}

function saveActiveChatRequest(request: ActiveChatRequest) {
  try {
    window.localStorage.setItem(activeChatRequestStorageKey, JSON.stringify(request));
  } catch {
    // Ignore storage failures; the visible pending turn is still present.
  }
}

function clearActiveChatRequest() {
  try {
    window.localStorage.removeItem(activeChatRequestStorageKey);
    window.localStorage.removeItem(legacyActiveChatRequestStorageKey);
  } catch {
    // Ignore storage failures.
  }
}

function isActiveChatRequestExpired(request: ActiveChatRequest) {
  const started = Date.parse(request.startedAt || "");
  if (!Number.isFinite(started)) return false;
  return Date.now() - started > activeChatRequestStaleMs;
}

function stoppedTurn(item: ConversationTurn, detail = "用户停止了本轮请求。"): ConversationTurn {
  return {
    ...item,
    assistant: "已停止本轮思考。",
    planner: { mode: "stopped", intent: "stopped", reason: "user_aborted_request" },
    toolCalls: [],
    progress: {
      ...(item.progress || {}),
      stage: "stopped",
      label: "已停止",
      detail,
      status: "stopped",
      updatedAt: new Date().toISOString()
    }
  };
}

function markTurnStopped(
  turnId: string,
  setTurns: React.Dispatch<React.SetStateAction<ConversationTurn[]>>,
  detail?: string
) {
  setTurns((items) => items.map((item) => item.id === turnId
    ? stoppedTurn(item, detail)
    : item
  ));
}

function saveHardwareStatus(status: HardwareStatusSnapshot) {
  try {
    window.localStorage.setItem(hardwareStatusStorageKey, JSON.stringify(status));
  } catch {
    // Ignore storage failures; the live hardware state still works.
  }
}

function selectBestPreflightPort(preflight: PreflightResult | null) {
  const openable = preflight?.openable_pnp_ports?.filter(Boolean) ?? [];
  if (openable.length === 1) return String(openable[0]);

  const probeOpenable = preflight?.windows_pnp_serial_probe_results
    ?.filter((item) => item.success && item.port)
    .map((item) => String(item.port)) ?? [];
  const uniqueProbePorts = [...new Set(probeOpenable)];
  return uniqueProbePorts.length === 1 ? uniqueProbePorts[0] : "";
}

function selectBestSerialPort(ports: SerialPortInfo[]) {
  const usbPorts = ports
    .filter((port) => port.device && port.is_usb_candidate && !port.is_bluetooth)
    .map((port) => port.device);
  const uniqueUsbPorts = [...new Set(usbPorts)];
  if (uniqueUsbPorts.length === 1) return uniqueUsbPorts[0];

  const nonBluetoothPorts = ports
    .filter((port) => port.device && !port.is_bluetooth)
    .map((port) => port.device);
  const uniqueNonBluetoothPorts = [...new Set(nonBluetoothPorts)];
  return uniqueNonBluetoothPorts.length === 1 ? uniqueNonBluetoothPorts[0] : "";
}

function applyBoardPreset(form: ConsoleForm, boardModel: string): ConsoleForm {
  const presets: Record<string, Pick<ConsoleForm, "board_model" | "board" | "flash_size" | "memory_type" | "partitions">> = {
    "esp32-s3-n16r8": { board_model: "esp32-s3-n16r8", board: "", flash_size: "16MB", memory_type: "qio_opi", partitions: "default_16MB.csv" },
    "esp32-s3-n8r8": { board_model: "esp32-s3-n8r8", board: "", flash_size: "8MB", memory_type: "qio_opi", partitions: "default_8MB.csv" },
    "esp32-s3-n8": { board_model: "esp32-s3-n8", board: "", flash_size: "8MB", memory_type: "qio", partitions: "default_8MB.csv" },
    "esp32-s3-devkitc-1": { board_model: "esp32-s3-devkitc-1", board: "", flash_size: "8MB", memory_type: "qio", partitions: "default_8MB.csv" },
    "luatos-esp32c3-core": { board_model: "luatos-esp32c3-core", board: "", flash_size: "4MB", memory_type: "", partitions: "default.csv" },
    "esp32-c3-devkitm-1": { board_model: "esp32-c3-devkitm-1", board: "", flash_size: "4MB", memory_type: "", partitions: "default.csv" },
    "esp32-c3-devkitc-02": { board_model: "esp32-c3-devkitc-02", board: "", flash_size: "4MB", memory_type: "", partitions: "default.csv" },
    "esp32-devkit-v1": { board_model: "esp32-devkit-v1", board: "", flash_size: "4MB", memory_type: "", partitions: "default.csv" },
    "esp32-wrover": { board_model: "esp32-wrover", board: "", flash_size: "4MB", memory_type: "", partitions: "default.csv" },
    "esp8266-nodemcuv2": { board_model: "esp8266-nodemcuv2", board: "nodemcuv2", flash_size: "4MB", memory_type: "", partitions: "" },
    "esp8266-d1-mini": { board_model: "esp8266-d1-mini", board: "d1_mini", flash_size: "4MB", memory_type: "", partitions: "" },
    "esp8266-esp12e": { board_model: "esp8266-esp12e", board: "esp12e", flash_size: "4MB", memory_type: "", partitions: "" }
  };
  return { ...form, ...(presets[boardModel] || presets["esp32-s3-n16r8"]) };
}

function applyPeripheralsToForm(form: ConsoleForm, peripherals: PeripheralConfig[]): ConsoleForm {
  let next = { ...form };
  for (const peripheral of peripherals.filter((item) => item.enabled)) {
    const pins = peripheral.pins || {};
    if (peripheral.templateId === "oled_spi_6pin") {
      next = {
        ...next,
        oled_protocol: "spi",
        oled_clk_pin: Number(pins.clk ?? next.oled_clk_pin),
        oled_mosi_pin: Number(pins.mosi ?? next.oled_mosi_pin),
        oled_reset_pin: Number(pins.res ?? next.oled_reset_pin),
        oled_dc_pin: Number(pins.dc ?? next.oled_dc_pin)
      };
    }
    if (peripheral.templateId === "oled_i2c_4pin") {
      next = {
        ...next,
        oled_protocol: "i2c",
        sda_pin: Number(pins.sda ?? next.sda_pin),
        scl_pin: Number(pins.scl ?? next.scl_pin),
        oled_reset_pin: Number(pins.res ?? next.oled_reset_pin),
        oled_dc_pin: -1
      };
    }
    if (peripheral.templateId === "aht20_i2c") {
      next = {
        ...next,
        sda_pin: Number(pins.sda ?? next.sda_pin),
        scl_pin: Number(pins.scl ?? next.scl_pin)
      };
    }
    if (peripheral.templateId === "led_gpio") {
      next = { ...next, led_pin: Number(pins.signal ?? pins.gpio ?? next.led_pin) };
    }
    if (peripheral.templateId === "passive_buzzer") {
      next = { ...next, buzzer_pin: Number(pins.signal ?? pins.gpio ?? next.buzzer_pin) };
    }
  }
  return next;
}

function resetPeripheralPins(form: ConsoleForm): ConsoleForm {
  return {
    ...form,
    sda_pin: -1,
    scl_pin: -1,
    oled_clk_pin: -1,
    oled_mosi_pin: -1,
    oled_reset_pin: -1,
    oled_dc_pin: -1,
    led_pin: -1,
    buzzer_pin: -1
  };
}

function getBoardPinMap(boardModel: string, knowledge?: BoardKnowledge | null): BoardPinMap {
  const boards = knowledge?.boards || [];
  const direct = boards.find((board) => board.boardModel === boardModel);
  const resolved = direct?.aliasOf ? boards.find((board) => board.boardModel === direct.aliasOf) : direct;
  if (resolved) {
    return {
      ...resolved,
      boardModel: direct?.boardModel || resolved.boardModel,
      title: direct?.title || resolved.title,
      displayName: direct?.displayName || resolved.displayName,
      aliasOf: direct?.aliasOf
    };
  }
  return {
    boardModel,
    title: "通用 ESP 开发板",
    displayName: boardModel,
    pins: [
      { label: "GPIO4", functions: ["GPIO"], status: "safe" },
      { label: "GPIO5", functions: ["GPIO"], status: "safe" },
      { label: "GPIO12", functions: ["GPIO"], status: "safe" },
      { label: "GPIO13", functions: ["GPIO"], status: "safe" },
      { label: "GPIO0", functions: ["GPIO", "STRAPPING"], status: "avoid" }
    ],
    safePins: ["GPIO4", "GPIO5", "GPIO12", "GPIO13"],
    avoidPins: ["GPIO0"],
    defaults: { sda: -1, scl: -1, led: -1, buzzer: -1, oled_res: -1, oled_dc: -1 },
    notes: ["未找到该型号的专用引脚图，已使用通用 ESP 引脚兜底信息；建议补充 esp_agent/knowledge/board_pinouts/boards.json。"]
  };
}

function normalizeBoardKnowledge(value: unknown): BoardKnowledge | null {
  if (!value || typeof value !== "object") return null;
  const source = value as { boards?: unknown[]; updated_at?: string; purpose?: string; usage_for_agent?: string };
  if (!Array.isArray(source.boards)) return null;
  const boards = source.boards
    .map((item) => normalizeBoardPinMap(item))
    .filter((item): item is BoardPinMap => Boolean(item));
  return {
    boards,
    updated_at: source.updated_at,
    purpose: source.purpose,
    usage_for_agent: source.usage_for_agent
  };
}

function normalizeBoardPinMap(value: unknown): BoardPinMap | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const boardModel = String(item.id || item.boardModel || "");
  if (!boardModel) return null;
  const aliasOf = item.alias_of ? String(item.alias_of) : item.aliasOf ? String(item.aliasOf) : undefined;
  const pins = Array.isArray(item.pins)
    ? item.pins.map((pin) => {
        const record = pin as Record<string, unknown>;
        const status: BoardPinDefinition["status"] = record.status === "avoid" || record.status === "default" ? record.status : "safe";
        return {
          label: String(record.label || ""),
          functions: Array.isArray(record.functions) ? record.functions.map(String) : [],
          status,
          role: record.role ? String(record.role) : undefined
        };
      }).filter((pin) => pin.label)
    : [];
  return {
    boardModel,
    title: String(item.display_name || item.title || boardModel),
    displayName: item.display_name ? String(item.display_name) : undefined,
    family: item.family ? String(item.family) : undefined,
    platformioBoard: item.platformio_board ? String(item.platformio_board) : undefined,
    aliasOf,
    pins,
    safePins: pins.filter((pin) => pin.status !== "avoid").map((pin) => pin.label),
    avoidPins: pins.filter((pin) => pin.status === "avoid").map((pin) => pin.label),
    defaults: { sda: -1, scl: -1, led: -1, buzzer: -1, oled_res: -1, oled_dc: -1 },
    notes: Array.isArray(item.notes) ? item.notes.map(String) : [],
    imageUrl: item.image_url ? String(item.image_url) : undefined,
    sourceUrl: item.source_url ? String(item.source_url) : undefined
  };
}

function loadLlmSettings(): LlmSettings {
  const defaults: LlmSettings = {
    enabled: false,
    mode: "auto",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "",
    modelTimeoutMs: 600_000,
    recursionLimit: 8,
    compileTimeoutSec: 600,
    uploadTimeoutSec: 180,
    monitorSeconds: 8
  };
  try {
    const raw = window.localStorage.getItem(llmStorageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return { ...defaults, ...parsed, apiKey: parsed.apiKey || "" };
  } catch {
    return defaults;
  }
}

function saveLlmSettings(settings: LlmSettings) {
  try {
    window.localStorage.setItem(llmStorageKey, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; the current settings still work for this page.
  }
}

function formatCheck(value: boolean) {
  return value ? "已确认" : "未确认";
}

function formatPeripheralLines(peripherals: PeripheralConfig[]) {
  const lines = peripherals.filter((item) => item.enabled).flatMap((item) => {
    const template = getPeripheralTemplate(item.templateId);
    if (!template) return [];
    return template.pins.map((pin) => {
      const value = Number(item.pins?.[pin.key] ?? pin.defaultValue);
      return `- ${template.name} / ${pin.label}: ${value >= 0 ? `GPIO${value}` : "未配置"}`;
    });
  });
  return lines.length ? lines : ["- 暂无已保存外设。"]; 
}

function exportHardwareHandoff(form: ConsoleForm, hardwareChecks: HardwareChecks, peripherals: PeripheralConfig[]) {
  const lines = [
    "# ESP 系列硬件配置清单",
    "",
    "## 当前板卡",
    "",
    `- Board model: ${form.board_model}`,
    `- Port: ${form.port || "未选择，任务只会生成和编译"}`,
    "",
    "## 已保存外设",
    "",
    ...formatPeripheralLines(peripherals),
    "",
    "## 通用检查",
    "",
    `- 外设引脚与实物接线一致: ${formatCheck(hardwareChecks.i2cSharedBus)}`,
    `- 输出 GPIO 未接启动/Flash/USB 占用脚: ${formatCheck(hardwareChecks.outputGpios)}`,
    `- 外设供电电压匹配: ${formatCheck(hardwareChecks.oledPower)}`,
    `- 所有模块 GND 共地: ${formatCheck(hardwareChecks.commonGround)}`,
    "",
    "## 引脚资料",
    "",
    "- 结构化资料：esp_agent/knowledge/board_pinouts/boards.json",
    "- Embex 通过 hardwareStatus.boardPinMap 读取当前板卡引脚功能。"
  ];
  downloadMarkdown(`${form.project_name || "esp"}_hardware_handoff.md`, lines);
}

function exportReport(
  form: ConsoleForm,
  hardwareChecks: HardwareChecks,
  result: ClosedLoopResult,
  peripherals: PeripheralConfig[],
  selectedTurn?: ConversationTurn | null,
  toolCalls: ToolCallView[] = []
) {
  const recAttempts = buildRecAttempts(toolCalls, result);
  const acceptance = asRecord(result.task_acceptance);
  const acceptanceEvidence = Array.isArray(acceptance.evidence) ? acceptance.evidence.map(String).filter(Boolean) : [];
  const lines = [
    "# ESP 系列闭环调试报告",
    "",
    "## 本轮任务",
    "",
    selectedTurn?.user || "未选中具体轮次。",
    "",
    "## Planner 决策",
    "",
    `- Mode: ${selectedTurn?.planner?.mode || "N/A"}`,
    `- Intent: ${selectedTurn?.planner?.intent || "N/A"}`,
    `- Reason: ${selectedTurn?.planner?.reason || "N/A"}`,
    selectedTurn?.progress ? `- Progress: ${selectedTurn.progress.status} / ${selectedTurn.progress.label} / ${selectedTurn.progress.detail || ""}` : "",
    "",
    "## 配置",
    "",
    `- Board model: ${form.board_model}`,
    `- Port: ${form.port || "未提供，烧录/串口阶段跳过"}`,
    "",
    "## 已保存外设",
    "",
    ...formatPeripheralLines(peripherals),
    "",
    "## 通用硬件确认",
    "",
    `- 外设引脚与实物接线一致: ${formatCheck(hardwareChecks.i2cSharedBus)}`,
    `- 输出 GPIO 未接启动/Flash/USB 占用脚: ${formatCheck(hardwareChecks.outputGpios)}`,
    `- 外设供电电压匹配: ${formatCheck(hardwareChecks.oledPower)}`,
    `- 所有模块 GND 共地: ${formatCheck(hardwareChecks.commonGround)}`,
    "",
    "## 任务验收",
    "",
    `- Result: ${acceptance.task_success === undefined ? (result.success ? "passed" : "failed") : acceptance.task_success ? "passed" : "failed"}`,
    `- Judged by: ${stringValue(acceptance.judged_by) || "N/A"}`,
    `- Verdict: ${stringValue(acceptance.verdict) || result.summary || "N/A"}`,
    `- Failed node: ${stringValue(acceptance.failed_node) || "N/A"}`,
    `- Next step: ${stringValue(acceptance.next_step) || "N/A"}`,
    `- Confidence: ${acceptance.confidence !== undefined ? `${Math.round(Number(acceptance.confidence) * 100)}%` : "N/A"}`,
    "",
    ...(acceptanceEvidence.length ? ["### 验收证据", "", ...acceptanceEvidence.map((item) => `- ${item}`), ""] : []),
    "## 执行步骤",
    "",
    ...result.steps.flatMap((step) => [
      `### ${step.name}`,
      "",
      `- Status: ${step.result.success === null ? "skipped" : step.result.success ? "ok" : "failed"}`,
      `- Summary: ${step.result.summary || step.result.next_step || ""}`,
      step.result.command ? `- Command: \`${step.result.command}\`` : "",
      step.result.project_dir ? `- Project dir: \`${step.result.project_dir}\`` : "",
      step.result.log ? ["", "```text", compactLog(step.result.log), "```"].join("\n") : "",
      ""
    ]),
    "## REC 调试轨迹",
    "",
    ...(recAttempts.length ? recAttempts.flatMap((attempt, index) => [
      `### ${index + 1}. ${attempt.kind === "tool" ? "Tool" : "Step"} - ${attempt.name}`,
      "",
      `- Status: ${attempt.status}`,
      `- Reason: ${attempt.reason}`,
      `- Execute: ${attempt.execute}`,
      `- Observe: ${attempt.observe}`,
      `- Correct / Next: ${attempt.correct}`,
      ""
    ]) : ["暂无可审计 REC 轨迹。", ""]),
    "## 模型最终回复",
    "",
    selectedTurn?.assistant || "N/A",
    "",
    "## 诊断",
    "",
    `- Root cause: ${result.diagnosis?.root_cause || "N/A"}`,
    `- Confidence: ${Math.round((result.diagnosis?.confidence || 0) * 100)}%`,
    `- Next step: ${result.diagnosis?.next_step || "N/A"}`
  ];
  downloadMarkdown(`${form.project_name || "esp"}_debug_report.md`, lines);
}
function downloadMarkdown(filename: string, lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById("root")!).render(<App />);

