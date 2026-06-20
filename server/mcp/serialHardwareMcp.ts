import {
  listMergedEspSerialPorts,
  probeEspSerialPort
} from "../espToolBridge.js";

export type SerialHardwareMcpInput = {
  query?: string;
  port?: string;
  baud?: number;
};

export type SerialHardwareMcpResult = {
  success: boolean;
  summary: string;
  mode: "list_ports" | "probe_port";
  ports_result: unknown;
  probe_result?: unknown;
  selected_port?: string;
  baud?: number;
  next_step: string;
};

export async function runSerialHardwareMcp(input: SerialHardwareMcpInput): Promise<SerialHardwareMcpResult> {
  const query = String(input.query || "");
  const selectedPort = String(input.port || extractPort(query) || "").trim();
  const baud = normalizeBaud(input.baud);
  const portsResult = await listMergedEspSerialPorts();
  if (!selectedPort) {
    return {
      success: true,
      summary: "Serial hardware MCP listed current serial ports.",
      mode: "list_ports",
      ports_result: portsResult,
      next_step: "如需探测指定串口，请输入 /serial_hardware COM12 或在硬件页面选择端口。"
    };
  }
  const probeResult = await probeEspSerialPort(selectedPort, baud);
  return {
    success: true,
    summary: `Serial hardware MCP listed ports and probed ${selectedPort}.`,
    mode: "probe_port",
    ports_result: portsResult,
    probe_result: probeResult,
    selected_port: selectedPort,
    baud,
    next_step: "如果探测成功，可在后续固件任务中使用该端口烧录或监控串口日志。"
  };
}

function extractPort(query: string) {
  const windowsPort = query.match(/\bCOM\d+\b/i)?.[0];
  if (windowsPort) return windowsPort.toUpperCase();
  const unixPort = query.match(/\/dev\/(?:tty|cu)[\w.-]+/)?.[0];
  return unixPort || "";
}

function normalizeBaud(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 115200;
}
