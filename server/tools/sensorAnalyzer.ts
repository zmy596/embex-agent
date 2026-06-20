import type { AgentTask, ToolObservation } from "../types.js";

const ranges: Record<string, { min: number; max: number; label: string }> = {
  vcc: { min: 4.75, max: 5.25, label: "5V 供电" },
  current: { min: 0.02, max: 1.8, label: "系统电流" },
  temperature: { min: -20, max: 70, label: "板载温度" },
  i2c_error_rate: { min: 0, max: 0.02, label: "I2C 错误率" },
  packet_loss: { min: 0, max: 0.05, label: "无线丢包率" }
};

export function analyzeTelemetry(task: AgentTask): ToolObservation {
  const abnormal = task.telemetry.filter((point) => {
    const range = ranges[point.name];
    return range && (point.value < range.min || point.value > range.max);
  });

  if (abnormal.length === 0) {
    return {
      tool: "sensor_analyzer",
      title: "遥测数据分析",
      severity: "info",
      summary: "关键遥测指标均处于预设工程范围内。",
      evidence: task.telemetry.map((point) => `${point.name}=${point.value}${point.unit}`),
      recommendation: "若故障仍可复现，建议提升采样频率捕获瞬态波动。"
    };
  }

  return {
    tool: "sensor_analyzer",
    title: "遥测数据分析",
    severity: abnormal.some((point) => point.name === "vcc" || point.name === "temperature")
      ? "critical"
      : "warning",
    summary: `发现 ${abnormal.length} 个越界指标。`,
    evidence: abnormal.map((point) => {
      const range = ranges[point.name];
      return `${range.label}：${point.value}${point.unit}，建议范围 ${range.min}-${range.max}${point.unit}`;
    }),
    recommendation: "先定位越界指标对应的硬件链路，再执行软件参数修正。"
  };
}
