import { readFile } from "node:fs/promises";
import path from "node:path";

export type EspPinAnalyzerInput = {
  message: string;
  boardModel?: string;
  peripherals?: unknown[];
  hardwareStatus?: Record<string, unknown>;
  closedLoop?: Record<string, unknown>;
};

export type EspPinAnalyzerResult = {
  success: boolean;
  summary: string;
  board_model: string;
  board_name: string;
  source_file: string;
  findings: Array<{
    pin: string;
    status: "safe" | "avoid" | "default" | "unknown";
    functions: string[];
    evidence: string;
    recommendation: string;
  }>;
  suggestions: string[];
  matched_peripherals: Array<{
    name: string;
    pins: Record<string, number>;
  }>;
  notes: string[];
};

type PinStatus = "safe" | "avoid" | "default" | "unknown";

type BoardRecord = {
  id: string;
  display_name: string;
  family?: string;
  platformio_board?: string;
  alias_of?: string;
  notes?: string[];
  pins?: Array<{
    label: string;
    functions: string[];
    status: PinStatus;
  }>;
};

type BoardsFile = {
  boards: BoardRecord[];
  purpose?: string;
  usage_for_agent?: string;
};

type BoardPinRecord = NonNullable<BoardRecord["pins"]>[number];

const boardsPath = path.join(process.cwd(), "esp_agent", "knowledge", "board_pinouts", "boards.json");

export async function analyzeEspPins(input: EspPinAnalyzerInput): Promise<EspPinAnalyzerResult> {
  const boards = await loadBoards();
  const boardModel = normalizeBoardModel(input.boardModel || getHardwareBoardModel(input.hardwareStatus) || getHardwareBoardModel(input.closedLoop) || "");
  const board = resolveBoard(boardModel, boards);
  if (!board) {
    return {
      success: false,
      summary: `Unknown board model: ${boardModel || "empty"}`,
      board_model: boardModel || "unknown",
      board_name: boardModel || "unknown",
      source_file: "esp_agent/knowledge/board_pinouts/boards.json",
      findings: [],
      suggestions: [
        "请在硬件页面先选择开发板型号。",
        "如果你的板子是模组型号码，可先映射到同系列开发板。"
      ],
      matched_peripherals: [],
      notes: []
    };
  }

  const peripheralPins = extractPeripheralPins(input.peripherals);
  const messagePins = extractPinsFromText(input.message);
  const requestedPins = new Map<number, string>();
  for (const pin of [...peripheralPins, ...messagePins]) {
    requestedPins.set(pin.pin, pin.label);
  }

  const pinMap = new Map<string, BoardPinRecord>((board.pins || []).map((pin: BoardPinRecord) => [pin.label.toUpperCase(), pin]));
  const findings = [...requestedPins.entries()].map(([pinNumber, label]) => {
    const pinLabel = `GPIO${pinNumber}`;
    const boardPin = pinMap.get(pinLabel);
    const functions = boardPin && Array.isArray(boardPin.functions) ? boardPin.functions : [];
    const status = normalizePinStatus(boardPin?.status);
    return {
      pin: pinLabel,
      status,
      functions,
      evidence: boardPin
        ? `${pinLabel} 在 ${board.display_name} 中标记为 ${status}，功能包括 ${functions.join(", ")}`
        : `${board.display_name} 中没有找到 ${pinLabel} 的结构化记录`,
      recommendation: buildRecommendation(status, pinLabel, label, functions)
    };
  });

  const matchedPeripherals = summarizePeripherals(input.peripherals);
  const suggestions = buildSuggestions(board, findings, matchedPeripherals, input.message);
  const summary = findings.length > 0
    ? `${board.display_name} 的 ${findings.length} 个候选 GPIO 已完成分析。`
    : `${board.display_name} 已加载，但当前消息没有提取到明确 GPIO。`;

  return {
    success: true,
    summary,
    board_model: board.id,
    board_name: board.display_name,
    source_file: "esp_agent/knowledge/board_pinouts/boards.json",
    findings,
    suggestions,
    matched_peripherals: matchedPeripherals,
    notes: Array.isArray(board.notes) ? board.notes : []
  };
}

async function loadBoards() {
  const text = await readFile(boardsPath, "utf8");
  const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as BoardsFile;
  return Array.isArray(parsed.boards) ? parsed.boards : [];
}

function resolveBoard(boardModel: string, boards: BoardRecord[]): BoardRecord | null {
  const normalized = boardModel.toLowerCase();
  const direct = boards.find((board) => board.id.toLowerCase() === normalized);
  if (direct) return expandBoard(direct, boards);
  const alias = boards.find((board) => board.alias_of && board.id.toLowerCase() === normalized);
  if (alias) return expandBoard(resolveBoard(alias.alias_of || "", boards) || alias, boards);
  const platformio = boards.find((board) => board.platformio_board?.toLowerCase() === normalized);
  return platformio ? expandBoard(platformio, boards) : null;
}

function expandBoard(board: BoardRecord, boards: BoardRecord[]) {
  if (!board.alias_of) return board;
  const base = boards.find((item) => item.id === board.alias_of);
  if (!base) return board;
  return {
    ...base,
    id: board.id,
    display_name: board.display_name || base.display_name,
    platformio_board: board.platformio_board || base.platformio_board
  };
}

function normalizeBoardModel(value: string) {
  return String(value || "").trim().toLowerCase();
}

function getHardwareBoardModel(value?: Record<string, unknown>) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return String(record.board_model || record.boardModel || record.project_board || "").trim();
}

function extractPinsFromText(text: string) {
  const matches = [...text.matchAll(/GPIO\s*(\d+)/gi)];
  return [...new Map(matches.map((match) => [Number(match[1]), `GPIO${match[1]}`])).entries()].map(([pin, label]) => ({ pin, label }));
}

function extractPeripheralPins(peripherals?: unknown[]) {
  const pins: Array<{ pin: number; label: string }> = [];
  for (const item of peripherals || []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const pinMap = extractPinMap(record);
    for (const [key, value] of Object.entries(pinMap)) {
      if (Number.isFinite(value)) {
        pins.push({ pin: Math.trunc(value), label: `${String(record.name || record.type || "peripheral")} ${key}` });
      }
    }
  }
  return pins;
}

function extractPinMap(record: Record<string, unknown>) {
  const result: Record<string, number> = {};
  const direct = record.pins;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    for (const [key, value] of Object.entries(direct as Record<string, unknown>)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) result[key] = parsed;
    }
  }
  for (const key of ["sda_pin", "scl_pin", "oled_clk_pin", "oled_mosi_pin", "oled_reset_pin", "oled_dc_pin", "led_pin", "buzzer_pin", "signal_pin"]) {
    const parsed = Number(record[key]);
    if (Number.isFinite(parsed)) result[key] = parsed;
  }
  return result;
}

function buildRecommendation(status: string, pinLabel: string, peripheralLabel: string, functions: string[]) {
  if (status === "avoid") {
    return `${pinLabel} 不建议用于 ${peripheralLabel}，优先选择 safe 引脚。`;
  }
  if (functions.some((item) => /USB_D|STRAPPING|FLASH/.test(item))) {
    return `${pinLabel} 具备特殊启动或 USB 功能，建议只在明确确认不冲突时使用。`;
  }
  return `${pinLabel} 可作为 ${peripheralLabel} 候选，后续还要结合供电和协议确认。`;
}

function normalizePinStatus(value: unknown): PinStatus {
  return value === "safe" || value === "avoid" || value === "default" ? value : "unknown";
}

function buildSuggestions(board: BoardRecord, findings: EspPinAnalyzerResult["findings"], matchedPeripherals: EspPinAnalyzerResult["matched_peripherals"], message: string) {
  const suggestions = new Set<string>();
  if (findings.some((item) => item.status === "avoid")) {
    suggestions.add("优先避开 status=avoid 的 GPIO，尤其是 USB、STRAPPING、FLASH 相关脚。");
  }
  if (/oled/i.test(message) && findings.some((item) => item.pin === "GPIO18" && item.status === "avoid")) {
    suggestions.add("如果是 ESP32-C3 且使用 OLED，优先核对 GPIO18 是否与 USB_D- 冲突。");
  }
  if (matchedPeripherals.length > 0) {
    suggestions.add("请确认 peripherals 中记录的引脚与实际接线一致，再决定是否烧录。");
  }
  if ((board.notes || []).length > 0) {
    suggestions.add(`已读取板卡备注：${board.notes?.[0]}`);
  }
  if (suggestions.size === 0) {
    suggestions.add("当前未发现明显高风险 GPIO，但仍需结合实际外设协议和供电确认。");
  }
  return [...suggestions];
}

function summarizePeripherals(peripherals?: unknown[]) {
  return (peripherals || [])
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map((item) => ({
      name: String(item?.name || item?.type || "peripheral"),
      pins: extractPinMap(item || {})
    }))
    .filter((item) => Object.keys(item.pins).length > 0);
}
