import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(args.out || path.join("runs", "hardware-readiness"));
const reportPath = path.join(outDir, "hardware-readiness.md");
const jsonPath = path.join(outDir, "hardware-readiness.json");

const preflight = runNodeScript("scripts/hardware-preflight.mjs");
const usb = runPowerShellScript("scripts/usb-uart-diagnose.ps1", ["-Summary"]);
const recommendedPort = pickPort(preflight);
const result = {
  generated_at: new Date().toISOString(),
  ready: Boolean(preflight.ready_for_compile && preflight.ready_for_upload && recommendedPort),
  recommended_port: recommendedPort,
  preflight,
  usb,
  next_command: recommendedPort
    ? renderHardwareRunCommand(recommendedPort)
    : null,
  next_steps: recommendedPort
    ? [
        `Use ${recommendedPort} as the Web/CLI upload port.`,
        "Run the hardware closed loop and inspect task-specific serial evidence."
      ]
    : [
        "Replug the ESP board.",
        "Try another USB data cable and another USB port.",
        "Remove stale CH347/CH343/CH340 COM devices from Device Manager.",
        "Reinstall the WCH CH347/CH343/CH340 driver.",
        "Run `npm run hardware:readiness` again until `recommended_port` is not null."
      ]
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
fs.writeFileSync(reportPath, renderMarkdown(result), "utf-8");

console.log(JSON.stringify({
  success: true,
  ready: result.ready,
  recommended_port: result.recommended_port,
  report: reportPath,
  json: jsonPath,
  next_command: result.next_command,
  next_steps: result.next_steps
}, null, 2));

if (args.strict === "true" && !result.ready) {
  process.exit(1);
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: process.env,
    timeout: 120_000
  });
  if (result.status !== 0) {
    return {
      success: false,
      error: result.stderr || result.stdout || `${scriptPath} failed`
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      success: false,
      error: `Unable to parse ${scriptPath} output`,
      stdout: result.stdout
    };
  }
}

function runPowerShellScript(scriptPath, scriptArgs) {
  if (process.platform !== "win32") return { success: true, skipped: true };
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 60_000
  });
  if (result.status !== 0) {
    return {
      success: false,
      error: result.stderr || result.stdout || `${scriptPath} failed`
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      success: false,
      error: `Unable to parse ${scriptPath} output`,
      stdout: result.stdout
    };
  }
}

function pickPort(preflight) {
  const openable = Array.isArray(preflight.openable_pnp_ports) ? preflight.openable_pnp_ports : [];
  if (openable.length > 0) return String(openable[0]);
  const usbCandidates = Array.isArray(preflight.usb_candidates) ? preflight.usb_candidates : [];
  const probeResults = Array.isArray(preflight.windows_pnp_serial_probe_results)
    ? preflight.windows_pnp_serial_probe_results
    : [];
  const failedPorts = new Set(probeResults.filter((item) => item.success === false).map((item) => String(item.port || "").toUpperCase()));
  const directCandidate = usbCandidates.find((item) => item.device && !failedPorts.has(String(item.device).toUpperCase()));
  return directCandidate?.device ? String(directCandidate.device) : "";
}

function renderHardwareRunCommand(port) {
  return `& "D:\\code\\anaconda\\envs\\yd-agent\\npm.cmd" run hardware:run -- --port ${port} --board-model luatos-esp32c3-core`;
}

function renderMarkdown(result) {
  const preflight = result.preflight || {};
  const probeRows = Array.isArray(preflight.windows_pnp_serial_probe_results)
    ? preflight.windows_pnp_serial_probe_results
    : [];
  const candidateRows = Array.isArray(preflight.windows_pnp_usb_uart_candidates)
    ? preflight.windows_pnp_usb_uart_candidates
    : [];
  const lines = [
    "# Embex ESP 硬件就绪报告",
    "",
    `- Generated: ${result.generated_at}`,
    `- Ready for compile: ${Boolean(preflight.ready_for_compile)}`,
    `- Ready for upload: ${Boolean(preflight.ready_for_upload)}`,
    `- Recommended port: ${result.recommended_port || "none"}`,
    `- Python: ${preflight.python || ""}`,
    `- PlatformIO: ${preflight.platformio || ""}`,
    `- pyserial: ${preflight.pyserial || ""}`,
    "",
    "## Windows PnP 候选设备",
    "",
    "| Friendly name | Status | Manufacturer |",
    "|---|---|---|",
    ...candidateRows.map((item) => `| ${item.friendly_name || ""} | ${item.status || ""} | ${item.manufacturer || ""} |`),
    candidateRows.length === 0 ? "| none |  |  |" : "",
    "",
    "## pyserial 打开探测",
    "",
    "| Port | Success | Error | Message |",
    "|---|---:|---|---|",
    ...probeRows.map((item) => `| ${item.port || ""} | ${Boolean(item.success)} | ${item.error_type || ""} | ${String(item.message || "").replaceAll("|", "\\|")} |`),
    probeRows.length === 0 ? "| none | false |  | No PnP serial port was probed. |" : "",
    "",
    "## 下一步",
    "",
    ...result.next_steps.map((item) => `- ${item}`),
    "",
    result.next_command ? "## 建议运行命令" : "",
    result.next_command ? "" : "",
    result.next_command ? "```powershell" : "",
    result.next_command || "",
    result.next_command ? "```" : ""
  ].filter((line) => line !== "");
  return `${lines.join("\n")}\n`;
}

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

