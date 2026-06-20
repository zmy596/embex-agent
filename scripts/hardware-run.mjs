import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveEspPython, pythonEnv } from "./runtime-env.mjs";

const pythonCommand = resolveEspPython();
const args = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(args.out || path.join("runs", timestamp));
const defaultReadinessReport = path.join(process.cwd(), "runs", "hardware-readiness", "hardware-readiness.md");
const autoPort = args.auto_port === "true";
const readiness = autoPort ? loadOrCreateReadiness() : null;
const selectedPort = args.port || readiness?.recommended_port || undefined;

const payload = {
  project_name: args.project || "embex_task",
  board_model: normalizeBoardModel(args.board_model),
  port: selectedPort,
  flash_size: args.flash_size || "",
  memory_type: args.memory_type || "",
  partitions: args.partitions || "",
  sda_pin: toInt(args.sda, -1),
  scl_pin: toInt(args.scl, -1),
  oled_reset_pin: toInt(args.oled_res, -1),
  oled_dc_pin: toInt(args.oled_dc, -1),
  led_pin: toInt(args.led, -1),
  buzzer_pin: toInt(args.buzzer, -1)
};

fs.mkdirSync(outputDir, { recursive: true });

if (autoPort && !selectedPort) {
  const skippedReport = {
    generated_at: new Date().toISOString(),
    success: false,
    skipped: true,
    reason: "auto_port_requested_but_no_recommended_port",
    payload,
    readiness,
    next_step: "Run npm run hardware:readiness after fixing USB-UART enumeration, then retry hardware:run -- --auto-port."
  };
  fs.writeFileSync(path.join(outputDir, "result.json"), `${JSON.stringify(skippedReport, null, 2)}\n`, "utf-8");
  fs.writeFileSync(path.join(outputDir, "serial.log"), "", "utf-8");
  fs.writeFileSync(path.join(outputDir, "report.md"), renderSkippedMarkdown(skippedReport), "utf-8");
  console.log(JSON.stringify({
    success: false,
    skipped: true,
    outputDir,
    reason: skippedReport.reason,
    readiness_report: readiness?.report || defaultReadinessReport,
    next_step: skippedReport.next_step
  }, null, 2));
  process.exit(0);
}

const script = [
  "import json, sys",
  "sys.path.insert(0, 'esp_agent/tools')",
  "from esp_platformio_tools import esp_run_closed_loop",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result=esp_run_closed_loop(**payload)",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");

const result = spawnSync(pythonCommand, ["-c", script], {
  cwd: process.cwd(),
  input: JSON.stringify(payload),
  env: pythonEnv(),
  encoding: "utf-8",
  timeout: args.port ? 900_000 : 700_000
});

if (result.status !== 0) {
  const errorReport = {
    success: false,
    command_error: result.stderr || result.stdout || result.error?.message || "hardware run failed",
    payload
  };
  fs.writeFileSync(path.join(outputDir, "result.json"), `${JSON.stringify(errorReport, null, 2)}\n`, "utf-8");
  console.error(JSON.stringify(errorReport, null, 2));
  process.exit(result.status || 1);
}

const closedLoop = JSON.parse(result.stdout);
const report = {
  generated_at: new Date().toISOString(),
  payload,
  auto_port: autoPort,
  readiness,
  closed_loop: closedLoop,
  observation: extractStep(closedLoop, "task_observation_check"),
  diagnosis: closedLoop.diagnosis
};

fs.writeFileSync(path.join(outputDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
fs.writeFileSync(path.join(outputDir, "serial.log"), `${extractSerialLog(closedLoop)}\n`, "utf-8");
fs.writeFileSync(path.join(outputDir, "report.md"), renderMarkdown(report), "utf-8");

console.log(JSON.stringify({
  success: closedLoop.success,
  outputDir,
  root_cause: closedLoop.diagnosis?.root_cause,
  observation: report.observation
    ? { success: report.observation.success, passed: report.observation.passed, total: report.observation.total }
    : null,
  steps: closedLoop.steps?.map((step) => ({
    name: step.name,
    success: step.result?.success ?? null,
    summary: step.result?.summary || step.result?.next_step || ""
  }))
}, null, 2));

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-/g, "_");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = "true";
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

function loadOrCreateReadiness() {
  const readinessPath = path.join(process.cwd(), "runs", "hardware-readiness", "hardware-readiness.json");
  const existing = readJson(readinessPath);
  if (existing?.recommended_port) return existing;

  const result = spawnSync(process.execPath, ["scripts/hardware-readiness.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf-8",
    timeout: 180_000
  });
  if (result.status !== 0) {
    return {
      ready: false,
      recommended_port: "",
      error: result.stderr || result.stdout || "hardware readiness failed"
    };
  }
  return readJson(readinessPath) || {
    ready: false,
    recommended_port: "",
    stdout: result.stdout
  };
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeBoardModel(value) {
  const text = String(value || "").trim();
  return /^(auto|unknown|none|null|undefined)$/i.test(text) ? "" : text;
}

function extractStep(result, name) {
  return result.steps?.find((step) => step.name === name)?.result || null;
}

function extractSerialLog(result) {
  return result.steps
    ?.filter((step) => step.name === "monitor")
    .map((step) => step.result?.log || "")
    .filter(Boolean)
    .join("\n") || "";
}

function renderMarkdown(report) {
  const steps = report.closed_loop.steps || [];
  const observation = report.observation;
  const configuredPins = [
    ["SDA", report.payload.sda_pin],
    ["SCL", report.payload.scl_pin],
    ["OLED RES", report.payload.oled_reset_pin],
    ["OLED DC", report.payload.oled_dc_pin],
    ["LED", report.payload.led_pin],
    ["Buzzer", report.payload.buzzer_pin]
  ].filter(([, value]) => Number(value) >= 0);
  const lines = [
    "# Embex 硬件闭环运行报告",
    "",
    "## 基本信息",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Project: ${report.payload.project_name}`,
    `- Board model: ${report.payload.board_model || "unspecified"}`,
    `- Port: ${report.payload.port || "未选择/仅编译"}`,
    `- Flash size: ${report.payload.flash_size}`,
    `- Memory type: ${report.payload.memory_type}`,
    `- Partitions: ${report.payload.partitions}`,
    ...configuredPins.map(([name, value]) => `- ${name}: GPIO${value}`),
    configuredPins.length === 0 ? "- Pins: 未配置外设引脚" : "",
    "",
    "## 执行步骤",
    "",
    ...steps.flatMap((step) => [
      `- ${step.name}: ${step.result?.success === null ? "skipped" : step.result?.success ? "ok" : "failed"}${step.result?.summary ? ` - ${step.result.summary}` : ""}`
    ]),
    "",
    "## 诊断结果",
    "",
    `- Root cause: ${report.diagnosis?.root_cause || "unknown"}`,
    `- Confidence: ${Math.round((report.diagnosis?.confidence || 0) * 100)}%`,
    `- Next step: ${report.diagnosis?.next_step || ""}`,
    "",
    "## 任务观察",
    "",
    observation
      ? `- Observation: ${observation.success ? "passed" : "incomplete"} (${observation.passed}/${observation.total})`
      : "- Observation: 未执行任务观察或没有观察结果",
    "",
    ...(observation?.checks || []).map((item) => `- ${item.passed ? "[x]" : "[ ]"} ${item.label}: ${item.passed ? item.evidence_required : item.action}`),
    "",
    "## 串口日志",
    "",
    "```text",
    extractSerialLog(report.closed_loop) || "No serial log captured.",
    "```",
    ""
  ];
  return lines.filter((line) => line !== "").join("\n");
}


function renderSkippedMarkdown(report) {
  const probeRows = report.readiness?.preflight?.windows_pnp_serial_probe_results || [];
  const lines = [
    "# Embex 硬件闭环运行报告",
    "",
    "## 状态",
    "",
    "- Result: skipped",
    `- Reason: ${report.reason}`,
    `- Next step: ${report.next_step}`,
    `- Board model: ${report.payload?.board_model || "unspecified"}`,
    "",
    "## 自动串口选择",
    "",
    `- Recommended port: ${report.readiness?.recommended_port || "none"}`,
    `- Ready for upload: ${Boolean(report.readiness?.preflight?.ready_for_upload)}`,
    "",
    "## pyserial 打开探测",
    "",
    "| Port | Success | Error | Message |",
    "|---|---:|---|---|",
    ...probeRows.map((item) => `| ${item.port || ""} | ${Boolean(item.success)} | ${item.error_type || ""} | ${String(item.message || "").replaceAll("|", "\\|")} |`),
    probeRows.length === 0 ? "| none | false |  | No serial probe result. |" : "",
    ""
  ];
  return lines.join("\n");
}

