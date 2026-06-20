import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveEspPython, pythonEnv } from "./runtime-env.mjs";

const pythonCommand = resolveEspPython();

const script = [
  "import json, sys",
  "sys.path.insert(0, 'esp_agent/tools')",
  "from esp_platformio_tools import esp_preflight",
  "print(json.dumps(esp_preflight(), ensure_ascii=False))"
].join("\n");

const result = spawnSync(pythonCommand, ["-c", script], {
  cwd: process.cwd(),
  env: pythonEnv(),
  encoding: "utf-8"
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const preflight = JSON.parse(result.stdout);
const pnp = runWindowsUsbDiagnosis();
const ports = preflight.ports?.ports || [];
const usbCandidates = ports.filter((port) => port.is_usb_candidate);
const bluetoothPorts = ports.filter((port) => port.is_bluetooth);
const toolSelftestOk = preflight.selftest?.success === true;
const pnpProbeResults = probePnpCandidatePorts(pnp?.candidates || []);
const openablePnpPorts = pnpProbeResults.filter((item) => item.success);

const report = {
  success: Boolean(preflight.ready_for_compile && toolSelftestOk),
  ready_for_compile: Boolean(preflight.ready_for_compile),
  ready_for_upload: Boolean(preflight.ready_for_upload || openablePnpPorts.length > 0),
  python: preflight.python,
  platformio: preflight.pio,
  pyserial: preflight.pyserial,
  tool_selftest_ok: toolSelftestOk,
  serial_ports_total: ports.length,
  usb_candidates: usbCandidates.map(formatPort),
  windows_pnp_usb_uart_candidates: pnp?.candidates || [],
  windows_pnp_usb_uart_ready: pnp?.usb_uart_ready ?? null,
  windows_pnp_serial_probe_results: pnpProbeResults,
  openable_pnp_ports: openablePnpPorts.map((item) => item.port),
  bluetooth_ports: bluetoothPorts.map(formatPort),
  next_step: nextStep(preflight, pnp, usbCandidates, openablePnpPorts, pnpProbeResults)
};

console.log(JSON.stringify(report, null, 2));

if (!report.ready_for_compile || !toolSelftestOk) {
  process.exit(1);
}

function formatPort(port) {
  return {
    device: port.device,
    description: port.description,
    manufacturer: port.manufacturer,
    hwid: port.hwid
  };
}

function runWindowsUsbDiagnosis() {
  if (process.platform !== "win32") return null;
  const scriptPath = path.join(process.cwd(), "scripts", "usb-uart-diagnose.ps1");
  if (!fs.existsSync(scriptPath)) return null;
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: pythonEnv(),
    timeout: 60_000
  });
  if (result.status !== 0) {
    return {
      success: false,
      error: result.stderr || result.stdout
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      success: false,
      error: `Unable to parse usb-uart-diagnose output: ${result.stdout}`
    };
  }
}

function probePnpCandidatePorts(candidates) {
  return candidates
    .map((item) => {
      const port = extractComPort(String(item.friendly_name || ""));
      if (!port) return null;
      return probeSerialPort(port);
    })
    .filter(Boolean);
}

function probeSerialPort(port) {
  const probeScript = [
    "import json, sys, time",
    "port = sys.argv[1]",
    "result = {'port': port, 'success': False}",
    "try:",
    "    import serial",
    "    ser = serial.Serial(port=port, baudrate=115200, timeout=0.2)",
    "    time.sleep(0.2)",
    "    result.update({'success': True, 'is_open': ser.is_open, 'message': 'Serial port opened successfully.'})",
    "    ser.close()",
    "except Exception as exc:",
    "    result.update({'success': False, 'message': str(exc), 'error_type': type(exc).__name__})",
    "print(json.dumps(result, ensure_ascii=False))"
  ].join("\n");

  const result = spawnSync(pythonCommand, ["-c", probeScript, port], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: pythonEnv(),
    timeout: 30_000
  });

  if (result.status !== 0) {
    return {
      port,
      success: false,
      error_type: "ProbeProcessError",
      message: result.stderr || result.stdout || "serial probe process failed"
    };
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      port,
      success: false,
      error_type: "ProbeParseError",
      message: `Unable to parse serial probe output: ${result.stdout}`
    };
  }
}

function extractComPort(value) {
  const match = value.match(/\((COM\d+)\)/i) || value.match(/\b(COM\d+)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function nextStep(preflight, pnp, usbCandidates, openablePnpPorts, pnpProbeResults) {
  if (usbCandidates.length > 0) {
    return "Select a USB-UART serial port and run the full loop.";
  }
  if (openablePnpPorts.length > 0) {
    return `Windows PnP candidate is openable by pyserial. Use ${openablePnpPorts[0].port} in Web or hardware:run.`;
  }
  if (pnpProbeResults.length > 0) {
    return "Windows PnP sees USB-UART candidates, but pyserial cannot open them. Replug the board, try another data cable/USB port, remove stale COM devices, or reinstall the WCH CH347/CH343/CH340 driver.";
  }
  if (pnp?.usb_uart_ready) {
    return "Windows PnP sees a USB-UART candidate, but pyserial did not mark it ready. Try the listed COM port directly, reconnect the board, or reinstall the WCH/CP210x driver.";
  }
  return preflight.next_step;
}
