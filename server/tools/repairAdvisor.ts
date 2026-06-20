import type { AgentTask, ToolObservation } from "../types.js";

export function adviseRepair(task: AgentTask): ToolObservation {
  const lowVcc = task.telemetry.find((point) => point.name === "vcc" && point.value < 4.75);
  const highI2c = task.telemetry.find((point) => point.name === "i2c_error_rate" && point.value > 0.02);
  const hot = task.telemetry.find((point) => point.name === "temperature" && point.value > 70);

  const actions: string[] = [];
  if (lowVcc) actions.push("更换低压降更小的稳压器或降低外设启动瞬态电流");
  if (highI2c) actions.push("将 I2C 速率从 400kHz 降至 100kHz，并检查 4.7k 上拉电阻");
  if (hot) actions.push("降低高负载任务占空比，并增加散热铜皮或散热片");
  if (/watchdog|wdt/i.test(task.serialLog)) actions.push("为关键任务增加喂狗点和执行时间监控");

  return {
    tool: "repair_advisor",
    title: "修复策略生成",
    severity: actions.length ? "warning" : "info",
    summary: actions.length ? "已生成面向硬件与固件的修复动作。" : "未发现需要立即执行的修复动作。",
    evidence: actions.length ? actions : ["当前证据不足以指向单一修复项"],
    recommendation: actions.length
      ? `建议按顺序执行：${actions.join("；")}。`
      : "增加复现实验，采集复位寄存器、总线波形和高频遥测。"
  };
}
