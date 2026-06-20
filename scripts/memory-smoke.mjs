import {
  appendMemoryTurn,
  clearMemory,
  exportMemory,
  getMemoryState,
  updateMemoryState
} from "../server/memory/memoryStore.ts";

await clearMemory();

const appendResult = await appendMemoryTurn({
  messages: [
    { role: "user", content: "记住当前开发板是 luatos-esp32c3-core，串口 COM12。" },
    { role: "assistant", content: "已记录硬件状态，后续 ESP 任务优先使用该配置。" }
  ],
  hardware_state: {
    board_model: "luatos-esp32c3-core",
    port: "COM12",
    peripherals: [{ type: "oled", protocol: "spi", clk: 5, mosi: 4, dc: 6, reset: 18 }]
  },
  project_state: {
    latest_success: "memory smoke"
  },
  tags: ["smoke", "hardware"]
});

if (!appendResult.success || appendResult.state.hardware_state.board_model !== "luatos-esp32c3-core") {
  throw new Error("appendMemoryTurn failed to persist hardware state");
}

const updateResult = await updateMemoryState({
  project_facts: ["Embex 面向 ESP 系列嵌入式开发。"],
  user_preferences: ["优先本地运行，避免依赖云服务。"]
});

if (!updateResult.state.project_facts.includes("Embex 面向 ESP 系列嵌入式开发。")) {
  throw new Error("updateMemoryState failed to persist project facts");
}

const stateResult = await getMemoryState();
if (!stateResult.success || stateResult.recent_turns.length < 1 || stateResult.state.short_term_context.length < 2) {
  throw new Error("getMemoryState failed to restore recent turns");
}

const exported = await exportMemory();
if (!exported.success || !exported.state.long_term_summary.includes("luatos-esp32c3-core")) {
  throw new Error("exportMemory failed to include compressed summary");
}

console.log(JSON.stringify({
  success: true,
  recent_turns: stateResult.recent_turns.length,
  short_term_messages: stateResult.state.short_term_context.length,
  hardware_board: stateResult.state.hardware_state.board_model,
  facts: stateResult.state.project_facts.length
}, null, 2));
