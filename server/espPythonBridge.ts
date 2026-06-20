import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const espToolsRoot = path.join(repoRoot, "esp_agent", "tools");
const pythonRunner = { command: process.env.ESP_AGENT_PYTHON || findDefaultPython(), args: [] };
const runnerScript = [
  "import json",
  "import sys",
  "from esp_platformio_tools import esp_run_closed_loop",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result=esp_run_closed_loop(**payload)",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");
const firmwareTaskScript = [
  "import json",
  "import sys",
  "from esp_platformio_tools import esp_run_firmware_task",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result=esp_run_firmware_task(**payload)",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");
const envScript = [
  "import json, shutil, subprocess, sys",
  "result={'python': sys.executable, 'pio': None, 'pyserial': None}",
  "try:\n import serial; result['pyserial']=serial.VERSION\nexcept Exception as e:\n result['pyserial_error']=str(e)",
  "try:\n p=subprocess.run([sys.executable,'-m','platformio','--version'], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30); result['pio']=p.stdout.strip(); result['pio_ok']=p.returncode==0\nexcept Exception as e:\n result['pio_error']=str(e); result['pio_ok']=False",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");
const portsScript = [
  "import json",
  "from esp_platformio_tools import esp_list_serial_ports",
  "print(json.dumps(esp_list_serial_ports(), ensure_ascii=False))"
].join("\n");
const diagnoseLogScript = [
  "import json",
  "import sys",
  "from esp_platformio_tools import esp_diagnose_log",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result=esp_diagnose_log(str(payload.get('log') or ''))",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");
const taskObservationScript = [
  "import json",
  "import sys",
  "from esp_platformio_tools import esp32_task_observation_check",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result=esp32_task_observation_check(str(payload.get('log') or ''), str(payload.get('task_description') or ''))",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");
const preflightScript = [
  "import json",
  "from esp_platformio_tools import esp_preflight",
  "print(json.dumps(esp_preflight(), ensure_ascii=False))"
].join("\n");
const probeSerialPortScript = [
  "import json, sys, time",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result={'success': False, 'port': payload.get('port'), 'baud': payload.get('baud')}",
  "try:",
  "    import serial",
  "    ser = serial.Serial(port=payload.get('port'), baudrate=int(payload.get('baud') or 115200), timeout=0.2)",
  "    time.sleep(0.2)",
  "    result.update({'success': True, 'is_open': ser.is_open, 'message': 'Serial port opened successfully.'})",
  "    ser.close()",
  "except Exception as exc:",
  "    result.update({'success': False, 'message': str(exc), 'error_type': type(exc).__name__})",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");

export interface ClosedLoopRequest {
  project_name?: string;
  board_model?: string;
  board?: string;
  port?: string;
  flash_size?: string;
  memory_type?: string;
  partitions?: string;
  sda_pin?: number;
  scl_pin?: number;
  oled_clk_pin?: number;
  oled_mosi_pin?: number;
  oled_reset_pin?: number;
  oled_dc_pin?: number;
  oled_protocol?: string;
  led_pin?: number;
  buzzer_pin?: number;
  compile_timeout_sec?: number;
  upload_timeout_sec?: number;
  monitor_seconds?: number;
}

export interface FirmwareTaskRequest extends ClosedLoopRequest {
  task_description: string;
  task?: string;
  custom_code?: string;
  oled_text?: string;
  compile_timeout_sec?: number;
  upload_timeout_sec?: number;
  monitor_seconds?: number;
  gpio_actions?: Array<{ pin: number; mode: "high" | "low" | "toggle"; period_ms?: number }>;
}

function findDefaultPython() {
  const candidates = [
    "D:\\code\\anaconda\\envs\\yd-agent\\python.exe",
    path.join(process.env.USERPROFILE || "", ".conda", "envs", "yd-agent", "python.exe"),
    path.join(process.env.CONDA_PREFIX || "", "envs", "yd-agent", "python.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "python";
}

export function runEspClosedLoop(payload: ClosedLoopRequest, signal?: AbortSignal): Promise<unknown> {
  return runPythonJson(runnerScript, { ...payload }, signal);
}

export function compileAndFlashGeneratedFirmware(payload: FirmwareTaskRequest, signal?: AbortSignal): Promise<unknown> {
  return runPythonJson(firmwareTaskScript, { ...payload }, signal);
}

export function checkEspEnvironment(): Promise<unknown> {
  return runPythonJson(envScript, {});
}

export function listEspSerialPorts(): Promise<unknown> {
  return runPythonJson(portsScript, {});
}

export async function listMergedSerialPorts(): Promise<unknown> {
  const base = await listEspSerialPorts() as {
    success?: boolean;
    ports?: Array<Record<string, unknown>>;
    summary?: string;
  };
  const pnp = await listWindowsPnpUsbUart();
  const ports = [...(Array.isArray(base.ports) ? base.ports : [])];
  const knownDevices = new Set(ports.map((port) => String(port.device || "").toUpperCase()));

  for (const item of pnp.candidates) {
    const device = extractComPort(String(item.friendly_name || ""));
    if (!device || knownDevices.has(device.toUpperCase())) continue;
    ports.push({
      device,
      description: item.friendly_name,
      hwid: item.instance_id,
      manufacturer: item.manufacturer,
      is_usb_candidate: true,
      is_bluetooth: false,
      source: "windows_pnp",
      pnp_status: item.status
    });
    knownDevices.add(device.toUpperCase());
  }

  ports.sort((a, b) => {
    const aUsb = a.is_usb_candidate ? 0 : 1;
    const bUsb = b.is_usb_candidate ? 0 : 1;
    if (aUsb !== bUsb) return aUsb - bUsb;
    return String(a.device || "").localeCompare(String(b.device || ""));
  });

  return {
    ...base,
    ports,
    windows_pnp_usb_uart_candidates: pnp.candidates,
    windows_pnp_usb_uart_ready: pnp.usb_uart_ready,
    summary: `${base.summary || `Found ${ports.length} serial port(s).`} Windows PnP USB-UART candidates: ${pnp.candidates.length}.`
  };
}


export function diagnoseEspLog(log: string): Promise<unknown> {
  return runPythonJson(diagnoseLogScript, { log });
}

export function checkEspTaskObservation(log: string, taskDescription = ""): Promise<unknown> {
  return runPythonJson(taskObservationScript, { log, task_description: taskDescription });
}

export async function runEspPreflight(): Promise<unknown> {
  const preflight = await runPythonJson(preflightScript, {}) as Record<string, unknown>;
  const portsPayload = await listMergedSerialPorts() as {
    ports?: Array<Record<string, unknown>>;
    windows_pnp_usb_uart_candidates?: Array<Record<string, unknown>>;
    windows_pnp_usb_uart_ready?: boolean;
  };
  const pnpProbeResults = await probePnpCandidatePorts(portsPayload.windows_pnp_usb_uart_candidates || []);
  const openablePnpPorts = pnpProbeResults
    .filter((item) => item.success)
    .map((item) => item.port)
    .filter(Boolean);

  return {
    ...preflight,
    ports: portsPayload,
    ready_for_upload: Boolean(preflight.ready_for_upload || openablePnpPorts.length > 0),
    windows_pnp_usb_uart_candidates: portsPayload.windows_pnp_usb_uart_candidates || [],
    windows_pnp_usb_uart_ready: Boolean(portsPayload.windows_pnp_usb_uart_ready),
    windows_pnp_serial_probe_results: pnpProbeResults,
    openable_pnp_ports: openablePnpPorts,
    next_step: enhancedPreflightNextStep(String(preflight.next_step || ""), pnpProbeResults, openablePnpPorts)
  };
}

export function probeEspSerialPort(port: string, baud = 115200): Promise<unknown> {
  return runPythonJson(probeSerialPortScript, { port, baud });
}

async function probePnpCandidatePorts(candidates: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const ports = candidates
    .map((item) => extractComPort(String(item.friendly_name || "")))
    .filter((port): port is string => Boolean(port));
  const uniquePorts = [...new Set(ports)].slice(0, 4);
  const results: Array<Record<string, unknown>> = [];
  for (const port of uniquePorts) {
    results.push(await probeEspSerialPort(port) as Record<string, unknown>);
  }
  return results;
}

function enhancedPreflightNextStep(
  original: string,
  probeResults: Array<Record<string, unknown>>,
  openablePorts: unknown[]
) {
  if (openablePorts.length > 0) {
    return `Use ${openablePorts.join(", ")} as the upload and serial monitor port.`;
  }
  const attemptedPorts = probeResults.map((item) => item.port).filter(Boolean).join(", ");
  if (attemptedPorts) {
    return `${original || "USB-UART candidates were found but could not be opened."} Probe attempted: ${attemptedPorts}. Close serial monitors or reconnect the board, then refresh ports.`;
  }
  return original || "Connect the ESP board through a USB data cable, install the USB-UART driver, then refresh serial ports.";
}


function listWindowsPnpUsbUart(): Promise<{
  usb_uart_ready: boolean;
  candidates: Array<Record<string, unknown>>;
}> {
  if (process.platform !== "win32") {
    return Promise.resolve({ usb_uart_ready: false, candidates: [] });
  }
  return new Promise((resolve) => {
    const scriptPath = path.join(repoRoot, "scripts", "usb-uart-diagnose.ps1");
    if (!fs.existsSync(scriptPath)) {
      resolve({ usb_uart_ready: false, candidates: [] });
      return;
    }
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Summary"], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONNOUSERSITE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => {
      resolve({ usb_uart_ready: false, candidates: [] });
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          usb_uart_ready: Boolean(parsed.usb_uart_ready),
          candidates: Array.isArray(parsed.candidates) ? parsed.candidates : []
        });
      } catch {
        resolve({ usb_uart_ready: false, candidates: [] });
      }
    });
  });
}

function extractComPort(value: string) {
  const match = value.match(/\((COM\d+)\)/i) || value.match(/\b(COM\d+)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function runPythonJson(script: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("ESP tool bridge aborted before start."));
      return;
    }
    const child = spawn(pythonRunner.command, [...pythonRunner.args, "-c", script], {
      cwd: espToolsRoot,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONNOUSERSITE: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      windowSetTimeoutKill(child);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (aborted || signal?.aborted) {
        reject(new Error("ESP tool bridge aborted."));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr || `ESP tool bridge exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Unable to parse ESP tool bridge output: ${stdout}\n${stderr}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function windowSetTimeoutKill(child: ReturnType<typeof spawn>) {
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 3000).unref();
}
