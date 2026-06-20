import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type MemoryConversationMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  created_at?: string;
};

export type MemoryTurn = {
  id: string;
  created_at: string;
  messages: MemoryConversationMessage[];
  hardware_state?: Record<string, unknown>;
  project_state?: Record<string, unknown>;
  tags: string[];
};

export type MemoryState = {
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
};

export type ProjectFactsFile = {
  version: number;
  facts: string[];
  updated_at: string;
};

const memoryRoot = path.join(process.cwd(), "memory");
const memoryStatePath = path.join(memoryRoot, "memory_state.json");
const conversationLogPath = path.join(memoryRoot, "conversation_log.jsonl");
const projectFactsPath = path.join(memoryRoot, "project_facts.json");
const maxShortTermMessages = 16;

const defaultMemoryState: MemoryState = {
  version: 1,
  short_term_context: [],
  long_term_summary: "",
  hardware_state: {},
  project_state: {},
  project_facts: [],
  user_preferences: [],
  failure_cases: [],
  updated_at: "",
  notes: []
};

const defaultProjectFacts: ProjectFactsFile = {
  version: 1,
  facts: [],
  updated_at: ""
};

export async function getMemoryState() {
  await ensureMemoryFiles();
  const [state, facts, recentTurns] = await Promise.all([
    readJsonFile<MemoryState>(memoryStatePath, defaultMemoryState),
    readJsonFile<ProjectFactsFile>(projectFactsPath, defaultProjectFacts),
    readRecentConversationTurns(20)
  ]);
  return {
    success: true,
    state: {
      ...defaultMemoryState,
      ...state,
      project_facts: Array.isArray(state.project_facts) && state.project_facts.length ? state.project_facts : facts.facts || []
    },
    project_facts: facts,
    recent_turns: recentTurns
  };
}

export async function appendMemoryTurn(input: {
  messages: MemoryConversationMessage[];
  hardware_state?: Record<string, unknown>;
  project_state?: Record<string, unknown>;
  tags?: string[];
}) {
  await ensureMemoryFiles();
  const now = new Date().toISOString();
  const turn: MemoryTurn = {
    id: `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    created_at: now,
    messages: input.messages.map((message) => ({
      ...message,
      created_at: message.created_at || now
    })),
    hardware_state: input.hardware_state || {},
    project_state: input.project_state || {},
    tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : []
  };

  await appendFile(conversationLogPath, `${JSON.stringify(turn)}\n`, "utf8");
  const current = await readJsonFile<MemoryState>(memoryStatePath, defaultMemoryState);
  const shortTerm = [...(current.short_term_context || []), ...turn.messages].slice(-maxShortTermMessages);
  const nextState: MemoryState = {
    ...defaultMemoryState,
    ...current,
    short_term_context: shortTerm,
    hardware_state: Object.keys(turn.hardware_state || {}).length ? turn.hardware_state || {} : current.hardware_state || {},
    project_state: Object.keys(turn.project_state || {}).length ? turn.project_state || {} : current.project_state || {},
    long_term_summary: buildExtractiveSummary(current.long_term_summary, shortTerm),
    updated_at: now,
    notes: [
      "Stage 3.1 memory store is active. Summary is extractive and will be upgraded in later steps.",
      ...((current.notes || []).filter((note) => !note.includes("Stage 1 placeholder")).slice(0, 5))
    ]
  };
  await writeJsonFile(memoryStatePath, nextState);
  return { success: true, turn, state: nextState };
}

export async function updateMemoryState(input: Partial<MemoryState>) {
  await ensureMemoryFiles();
  const current = await readJsonFile<MemoryState>(memoryStatePath, defaultMemoryState);
  const now = new Date().toISOString();
  const nextState: MemoryState = {
    ...defaultMemoryState,
    ...current,
    ...input,
    hardware_state: mergeRecord(current.hardware_state, input.hardware_state),
    project_state: mergeRecord(current.project_state, input.project_state),
    project_facts: mergeStringList(current.project_facts, input.project_facts),
    user_preferences: mergeStringList(current.user_preferences, input.user_preferences),
    failure_cases: Array.isArray(input.failure_cases) ? input.failure_cases : current.failure_cases || [],
    updated_at: now
  };
  await writeJsonFile(memoryStatePath, nextState);
  if (input.project_facts) {
    await writeJsonFile(projectFactsPath, {
      version: 1,
      facts: nextState.project_facts,
      updated_at: now
    });
  }
  return { success: true, state: nextState };
}

export async function clearMemory(options?: { keep_hardware?: boolean }) {
  await ensureMemoryFiles();
  const current = await readJsonFile<MemoryState>(memoryStatePath, defaultMemoryState);
  const now = new Date().toISOString();
  const nextState: MemoryState = {
    ...defaultMemoryState,
    hardware_state: options?.keep_hardware ? current.hardware_state || {} : {},
    updated_at: now,
    notes: ["Memory cleared by user or smoke test."]
  };
  await writeJsonFile(memoryStatePath, nextState);
  await writeFile(conversationLogPath, "", "utf8");
  await writeJsonFile(projectFactsPath, { ...defaultProjectFacts, updated_at: now });
  return { success: true, state: nextState };
}

export async function exportMemory() {
  const { success: _success, ...state } = await getMemoryState();
  return {
    success: true,
    exported_at: new Date().toISOString(),
    ...state
  };
}

async function ensureMemoryFiles() {
  await mkdir(memoryRoot, { recursive: true });
  await ensureFile(memoryStatePath, defaultMemoryState);
  await ensureFile(projectFactsPath, defaultProjectFacts);
  try {
    await readFile(conversationLogPath, "utf8");
  } catch {
    await writeFile(conversationLogPath, "", "utf8");
  }
}

async function ensureFile<T>(filePath: string, fallback: T) {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeJsonFile(filePath, fallback);
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(filePath, "utf8");
    if (!text.trim()) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readRecentConversationTurns(limit: number): Promise<MemoryTurn[]> {
  try {
    const text = await readFile(conversationLogPath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as MemoryTurn);
  } catch {
    return [];
  }
}

function buildExtractiveSummary(previous: string, messages: MemoryConversationMessage[]) {
  const latest = messages
    .filter((message) => message.content.trim())
    .slice(-6)
    .map((message) => `${message.role}: ${message.content.trim().replace(/\s+/g, " ").slice(0, 180)}`)
    .join("\n");
  const prefix = previous ? `${previous.trim()}\n` : "";
  return `${prefix}${latest}`.slice(-3000);
}

function mergeRecord(base?: Record<string, unknown>, patch?: Record<string, unknown>) {
  return {
    ...(base || {}),
    ...(patch || {})
  };
}

function mergeStringList(base?: string[], patch?: string[]) {
  return Array.from(new Set([...(base || []), ...(patch || []).map(String).filter(Boolean)]));
}
