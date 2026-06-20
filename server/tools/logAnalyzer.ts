import type { AgentTask, ToolObservation } from "../types.js";

const errorPatterns = [
  { pattern: /brown[- ]?out|undervoltage|low voltage/i, cause: "供电跌落", severity: "critical" as const },
  { pattern: /i2c.*(timeout|nack|error)/i, cause: "I2C 总线异常", severity: "warning" as const },
  { pattern: /uart.*(overflow|framing|parity)/i, cause: "串口通信错误", severity: "warning" as const },
  { pattern: /watchdog|wdt/i, cause: "看门狗复位", severity: "critical" as const },
  { pattern: /sensor.*(nan|invalid|disconnect)/i, cause: "传感器数据无效", severity: "warning" as const }
];

export function analyzeLog(task: AgentTask): ToolObservation {
  const hits = errorPatterns.filter(({ pattern }) => pattern.test(task.serialLog));
  const evidence = hits.map((hit) => `日志命中：${hit.cause}`);

  if (hits.length === 0) {
    return {
      tool: "log_analyzer",
      title: "串口日志分析",
      severity: "info",
      summary: "未在日志中发现明确的复位、总线或通信错误模式。",
      evidence: ["日志未命中内置高风险错误模式"],
      recommendation: "继续结合遥测数据和硬件连接状态判断。"
    };
  }

  const hasCritical = hits.some((hit) => hit.severity === "critical");
  return {
    tool: "log_analyzer",
    title: "串口日志分析",
    severity: hasCritical ? "critical" : "warning",
    summary: `发现 ${hits.length} 类异常：${hits.map((hit) => hit.cause).join("、")}。`,
    evidence,
    recommendation: hasCritical
      ? "优先检查电源完整性、复位原因寄存器和高负载瞬态。"
      : "建议复测总线波形、外设地址和通信速率配置。"
  };
}
