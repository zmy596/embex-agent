import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgent, sampleTask } from "./agent.js";
import { runConversationAgent } from "./conversationAgent.js";
import {
  checkEspTaskObservation,
  checkEspEnvironment,
  compileAndFlashGeneratedFirmware,
  diagnoseEspLog,
  listMergedEspSerialPorts,
  probeEspSerialPort,
  runEspClosedLoop,
  runEspPreflight
} from "./espToolBridge.js";
import {
  deleteKnowledgeDocument,
  listKnowledgeFiles,
  reindexKnowledge,
  searchKnowledge,
  uploadKnowledgeText
} from "./knowledge/ragStore.js";
import {
  appendMemoryTurn,
  clearMemory,
  exportMemory,
  getMemoryState,
  updateMemoryState
} from "./memory/memoryStore.js";
import {
  listSkills,
  setSkillEnabled
} from "./skills/skillRegistry.js";
import {
  listMcps,
  setMcpEnabled
} from "./mcp/mcpRegistry.js";
import type { AgentTask } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const activeChatRequests = new Map<string, AbortController>();
type CameraRole = "viewer" | "camera";
type CameraSignalEnvelope = {
  from: CameraRole;
  to: CameraRole;
  type: "offer" | "answer" | "ice" | "ready" | "hangup";
  payload?: unknown;
  sentAt: string;
};
type CameraSession = {
  id: string;
  createdAt: number;
  updatedAt: number;
  streams: Map<CameraRole, express.Response>;
};
type ChatRequestStatus = {
  requestId: string;
  stage: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  updatedAt: string;
  finalResult?: unknown;
  finalError?: string;
};
const chatRequestStatuses = new Map<string, ChatRequestStatus>();
const cameraSessions = new Map<string, CameraSession>();
const cameraSessionTtlMs = 2 * 60 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Embex" });
});

app.get("/api/cam/bootstrap", (_req, res) => {
  res.json({
    success: true,
    host,
    port,
    lanAddresses: getLanAddresses(),
    defaultViewerPath: "/cam/viewer.html",
    defaultCameraPath: "/cam/camera.html"
  });
});

app.post("/api/cam/session", (_req, res) => {
  pruneCameraSessions();
  const id = randomId(6);
  cameraSessions.set(id, {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    streams: new Map()
  });
  res.json({
    success: true,
    sessionId: id,
    viewerUrl: buildLocalUrl("/cam/viewer.html", id),
    cameraUrl: buildLocalUrl("/cam/camera.html", id),
    lanAddresses: getLanAddresses()
  });
});

app.get("/api/cam/session/:id", (req, res) => {
  pruneCameraSessions();
  const session = cameraSessions.get(String(req.params.id || "").trim());
  if (!session) {
    res.status(404).json({ success: false, message: "session not found" });
    return;
  }
  session.updatedAt = Date.now();
  res.json({
    success: true,
    sessionId: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    peers: {
      viewer: session.streams.has("viewer"),
      camera: session.streams.has("camera")
    }
  });
});

app.get("/api/cam/session/:id/events", (req, res) => {
  pruneCameraSessions();
  const sessionId = String(req.params.id || "").trim();
  const role = normalizeCameraRole(req.query.role);
  if (!role) {
    res.status(400).json({ success: false, message: "role must be viewer or camera" });
    return;
  }
  let session = cameraSessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      streams: new Map()
    };
    cameraSessions.set(sessionId, session);
  }
  session.updatedAt = Date.now();

  const previous = session.streams.get(role);
  if (previous) {
    writeSse(previous, "signal", {
      from: role,
      to: role,
      type: "hangup",
      sentAt: new Date().toISOString()
    });
    previous.end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  session.streams.set(role, res);
  writeSse(res, "ready", { role, sessionId, sentAt: new Date().toISOString() });
  broadcastCameraSignal(session, {
    from: role,
    to: role === "viewer" ? "camera" : "viewer",
    type: "ready",
    sentAt: new Date().toISOString()
  });

  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    const current = cameraSessions.get(sessionId);
    if (!current) return;
    if (current.streams.get(role) === res) {
      current.streams.delete(role);
      current.updatedAt = Date.now();
      broadcastCameraSignal(current, {
        from: role,
        to: role === "viewer" ? "camera" : "viewer",
        type: "hangup",
        sentAt: new Date().toISOString()
      });
    }
    if (!current.streams.size && Date.now() - current.updatedAt > 30_000) {
      cameraSessions.delete(sessionId);
    }
  });
});

app.post("/api/cam/session/:id/signal", (req, res) => {
  pruneCameraSessions();
  const session = cameraSessions.get(String(req.params.id || "").trim());
  if (!session) {
    res.status(404).json({ success: false, message: "session not found" });
    return;
  }
  const from = normalizeCameraRole(req.body?.from);
  const to = normalizeCameraRole(req.body?.to);
  const type = normalizeCameraSignalType(req.body?.type);
  if (!from || !to || !type) {
    res.status(400).json({ success: false, message: "invalid signal envelope" });
    return;
  }
  session.updatedAt = Date.now();
  const delivered = broadcastCameraSignal(session, {
    from,
    to,
    type,
    payload: req.body?.payload,
    sentAt: new Date().toISOString()
  });
  res.json({ success: true, delivered });
});

app.get("/api/sample-task", (_req, res) => {
  res.json(sampleTask);
});

app.get("/api/boards/pinouts", async (_req, res) => {
  try {
    const filePath = path.join(process.cwd(), "esp_agent", "knowledge", "board_pinouts", "boards.json");
    const text = await readFile(filePath, "utf8");
    res.type("application/json").send(text);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/models", async (req, res) => {
  try {
    const baseUrl = String(req.body?.baseUrl || "").replace(/\/+$/, "");
    const apiKey = String(req.body?.apiKey || "");
    if (!baseUrl) {
      res.status(400).json({ success: false, message: "Base URL is required." });
      return;
    }
    const response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      res.status(response.status).json({ success: false, message: response.statusText, raw: parsed });
      return;
    }
    const records = parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: Array<Record<string, unknown>> }).data
      : [];
    const models = records
      .map((item) => String(item.id || item.name || ""))
      .filter(Boolean);
    res.json({ success: true, models, raw: parsed });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/knowledge/files", async (_req, res) => {
  try {
    const result = await listKnowledgeFiles();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/knowledge/upload", async (req, res) => {
  try {
    const result = await uploadKnowledgeText({
      filename: String(req.body?.filename || req.body?.name || ""),
      title: String(req.body?.title || req.body?.filename || ""),
      content: String(req.body?.content || req.body?.text || ""),
      tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
      source: String(req.body?.source || "web_upload"),
      section: String(req.body?.section || "uploads")
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/knowledge/search", async (req, res) => {
  try {
    const result = await searchKnowledge(String(req.body?.query || req.body?.text || ""), Number(req.body?.limit || 5));
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.delete("/api/knowledge/files/:id", async (req, res) => {
  try {
    const result = await deleteKnowledgeDocument(String(req.params.id || ""));
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/knowledge/reindex", async (_req, res) => {
  try {
    const result = await reindexKnowledge();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/memory/state", async (_req, res) => {
  try {
    res.json(await getMemoryState());
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/memory/turn", async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const result = await appendMemoryTurn({
      messages: messages.map((message: Record<string, unknown>) => ({
        role: normalizeMemoryRole(message.role),
        content: String(message.content || ""),
        created_at: typeof message.created_at === "string" ? message.created_at : undefined
      })),
      hardware_state: req.body?.hardware_state && typeof req.body.hardware_state === "object" ? req.body.hardware_state : {},
      project_state: req.body?.project_state && typeof req.body.project_state === "object" ? req.body.project_state : {},
      tags: Array.isArray(req.body?.tags) ? req.body.tags : []
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/memory/update", async (req, res) => {
  try {
    const result = await updateMemoryState({
      long_term_summary: typeof req.body?.long_term_summary === "string" ? req.body.long_term_summary : undefined,
      hardware_state: req.body?.hardware_state && typeof req.body.hardware_state === "object" ? req.body.hardware_state : undefined,
      project_state: req.body?.project_state && typeof req.body.project_state === "object" ? req.body.project_state : undefined,
      project_facts: Array.isArray(req.body?.project_facts) ? req.body.project_facts.map(String) : undefined,
      user_preferences: Array.isArray(req.body?.user_preferences) ? req.body.user_preferences.map(String) : undefined,
      failure_cases: Array.isArray(req.body?.failure_cases) ? req.body.failure_cases : undefined
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/memory/clear", async (req, res) => {
  try {
    res.json(await clearMemory({ keep_hardware: Boolean(req.body?.keep_hardware) }));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/memory/export", async (_req, res) => {
  try {
    res.json(await exportMemory());
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/skills", async (_req, res) => {
  try {
    res.json(await listSkills());
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/skills/:name/enabled", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    if (!name) {
      res.status(400).json({ success: false, message: "skill name is required" });
      return;
    }
    res.json(await setSkillEnabled(name, Boolean(req.body?.enabled)));
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/mcps", async (_req, res) => {
  try {
    res.json(await listMcps());
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/mcps/:name/enabled", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    if (!name) {
      res.status(400).json({ success: false, message: "mcp name is required" });
      return;
    }
    res.json(await setMcpEnabled(name, Boolean(req.body?.enabled)));
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/agent/run", (req, res) => {
  const task = normalizeTask(req.body);
  res.json(runAgent(task));
});

app.post("/api/agent/chat", async (req, res) => {
  const requestId = String(req.body?.requestId || "").trim();
  const controller = new AbortController();
  const statusId = requestId || `server-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = new Date().toISOString();
  const updateStatus = (update: {
    stage: string;
    label: string;
    detail?: string;
    status?: "running" | "done" | "failed" | "stopped";
    finalResult?: unknown;
    finalError?: string;
  }) => {
    const existing = chatRequestStatuses.get(statusId);
    chatRequestStatuses.set(statusId, {
      ...existing,
      requestId: statusId,
      stage: update.stage,
      label: update.label,
      detail: update.detail,
      status: update.status || "running",
      startedAt,
      updatedAt: new Date().toISOString(),
      finalResult: update.finalResult ?? existing?.finalResult,
      finalError: update.finalError ?? existing?.finalError
    });
  };
  updateStatus({
    stage: "queued",
    label: "接收任务",
    detail: "后端已接收请求，准备进入 Embex 模型规划。",
    status: "running"
  });
  if (requestId) activeChatRequests.set(requestId, controller);
  try {
    const result = await runConversationAgent({
      message: String(req.body?.message || ""),
      log: String(req.body?.log || ""),
      closedLoop: normalizeConversationHardwareRequest(req.body?.closedLoop || req.body || {}),
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      hardwareStatus: req.body?.hardwareStatus && typeof req.body.hardwareStatus === "object" ? req.body.hardwareStatus : {},
      peripherals: Array.isArray(req.body?.peripherals) ? req.body.peripherals : [],
      llm: req.body?.llm,
      mode: req.body?.mode === "chat_only" ? "chat_only" : "auto",
      signal: controller.signal,
      progress: updateStatus
    });
    updateStatus({
      stage: "completed",
      label: "返回结果",
      detail: "模型已完成验收总结并返回最终结果。",
      status: "done",
      finalResult: result
    });
    res.json(result);
  } catch (error) {
    if (false) {
      updateStatus({
        stage: "timeout",
        label: "请求超时",
        detail: "整轮请求超时已禁用。",
        status: "failed"
      });
      res.status(504).json({
        success: false,
        timeout: true,
        message: "Embex request timeout is disabled."
      });
      return;
    }
    if (controller.signal.aborted) {
      updateStatus({
        stage: "stopped",
        label: "已停止",
        detail: "用户停止了本轮请求。",
        status: "stopped"
      });
      res.status(499).json({ success: false, stopped: true, message: "Embex request was stopped." });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    updateStatus({
      stage: "failed",
      label: "模型或服务异常",
      detail: message,
      status: "failed",
      finalError: message
    });
    res.status(500).json({
      success: false,
      message
    });
  } finally {
    if (requestId) activeChatRequests.delete(requestId);
  }
});

app.post("/api/agent/chat/cancel", (req, res) => {
  const requestId = String(req.body?.requestId || "").trim();
  const controller = requestId ? activeChatRequests.get(requestId) : undefined;
  if (controller) {
    controller.abort();
    activeChatRequests.delete(requestId);
  }
  const existing = requestId ? chatRequestStatuses.get(requestId) : undefined;
  if (existing) {
    chatRequestStatuses.set(requestId, {
      ...existing,
      stage: "stopped",
      label: "已停止",
      detail: "用户停止了本轮请求。",
      status: "stopped",
      updatedAt: new Date().toISOString()
    });
  }
  res.json({ success: true, requestId, cancelled: Boolean(controller) });
});

app.get("/api/agent/chat/status/:requestId", (req, res) => {
  const requestId = String(req.params.requestId || "").trim();
  const status = chatRequestStatuses.get(requestId);
  if (!status) {
    res.status(404).json({ success: false, requestId, message: "request status not found" });
    return;
  }
  res.json({ success: true, status });
});

app.post("/api/esp/closed-loop", async (req, res) => {
  try {
    const result = await runEspClosedLoop(normalizeClosedLoopRequest(req.body));
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/esp/firmware-task", async (req, res) => {
  try {
    const payload = normalizeConversationHardwareRequest(req.body);
    const result = await compileAndFlashGeneratedFirmware({
      ...payload,
      task_description: String(req.body?.task_description || req.body?.message || "")
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/esp/environment", async (_req, res) => {
  try {
    const result = await checkEspEnvironment();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/esp/ports", async (_req, res) => {
  try {
    const result = await listMergedEspSerialPorts();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/esp/diagnose-log", async (req, res) => {
  try {
    const log = String(req.body?.log || "");
    const taskDescription = String(req.body?.task_description || req.body?.taskDescription || "");
    const result = await diagnoseEspLog(log);
    const observation = await checkEspTaskObservation(log, taskDescription);
    res.json({
      success: true,
      steps: [
        {
          name: "manual_log",
          result: {
            success: true,
            summary: "Manual serial/build log diagnosed.",
            log,
            diagnosis: result
          }
        },
        {
          name: "task_observation_check",
          result: observation
        }
      ],
      diagnosis: result,
      observation,
      summary: "Manual log diagnosis completed."
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/esp/task-observation", async (req, res) => {
  try {
    const result = await checkEspTaskObservation(
      String(req.body?.log || ""),
      String(req.body?.task_description || req.body?.taskDescription || "")
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/esp/preflight", async (_req, res) => {
  try {
    const result = await runEspPreflight();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/esp/probe-serial", async (req, res) => {
  try {
    const port = String(req.body?.port || "").trim();
    if (!port) {
      res.status(400).json({ success: false, message: "port is required" });
      return;
    }
    const baud = toInt(req.body?.baud, 115200);
    const result = await probeEspSerialPort(port, baud);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});


app.listen(port, host, () => {
  console.log(`Embex API listening on http://${host}:${port}`);
  for (const address of getLanAddresses()) {
    console.log(`Embex LAN: http://${address}:${port}`);
  }
});

function normalizeTask(input: Partial<AgentTask>): AgentTask {
  return {
    task: String(input.task || sampleTask.task),
    board: String(input.board || sampleTask.board),
    serialLog: String(input.serialLog || sampleTask.serialLog),
    telemetry: Array.isArray(input.telemetry) && input.telemetry.length
      ? input.telemetry.map((point) => ({
          name: String(point.name),
          value: Number(point.value),
          unit: String(point.unit ?? "")
        }))
      : sampleTask.telemetry
  };
}

function normalizeClosedLoopRequest(input: Record<string, unknown>) {
  const portValue = String(input.port ?? "").trim();
  return {
    project_name: String(input.project_name || "embex_task"),
    board_model: normalizeBoardModelValue(input.board_model),
    board: String(input.board || ""),
    port: portValue || undefined,
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

function normalizeBoardModelValue(value: unknown) {
  const text = String(value || "").trim();
  return /^(auto|unknown|none|null|undefined)$/i.test(text) ? "" : text;
}

function normalizeConversationHardwareRequest(input: Record<string, unknown>) {
  return {
    ...normalizeClosedLoopRequest(input),
    task: String(input.task || "auto"),
    custom_code: String(input.custom_code || ""),
    oled_text: String(input.oled_text || "")
  };
}

function toInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeMemoryRole(role: unknown): "user" | "assistant" | "tool" | "system" {
  return role === "assistant" || role === "tool" || role === "system" ? role : "user";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function randomId(length: number) {
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

function getLanAddresses() {
  const networks = os.networkInterfaces();
  const ranked: Array<{ address: string; rank: number }> = [];
  const seen = new Set<string>();
  for (const [name, entries] of Object.entries(networks)) {
    const lowered = name.toLowerCase();
    if (lowered.includes("vmware") || lowered.includes("virtualbox") || lowered.includes("vethernet")) {
      continue;
    }
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        if (seen.has(entry.address)) continue;
        seen.add(entry.address);
        ranked.push({
          address: entry.address,
          rank: lowered.includes("wlan") || lowered.includes("wi-fi") || lowered.includes("wireless") ? 0 : 1
        });
      }
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address)).map((item) => item.address);
}

function buildLocalUrl(pagePath: string, sessionId: string) {
  const preferred = getLanAddresses()[0] || "127.0.0.1";
  return `http://${preferred}:${port}${pagePath}?session=${encodeURIComponent(sessionId)}`;
}

function normalizeCameraRole(value: unknown): CameraRole | null {
  return value === "viewer" || value === "camera" ? value : null;
}

function normalizeCameraSignalType(value: unknown): CameraSignalEnvelope["type"] | null {
  return value === "offer" || value === "answer" || value === "ice" || value === "ready" || value === "hangup"
    ? value
    : null;
}

function pruneCameraSessions() {
  const now = Date.now();
  for (const [id, session] of cameraSessions.entries()) {
    if (now - session.updatedAt <= cameraSessionTtlMs) continue;
    for (const response of session.streams.values()) response.end();
    cameraSessions.delete(id);
  }
}

function broadcastCameraSignal(session: CameraSession, signal: CameraSignalEnvelope) {
  const target = session.streams.get(signal.to);
  if (!target) return false;
  writeSse(target, "signal", signal);
  return true;
}

function writeSse(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
