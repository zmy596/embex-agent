import type { AgentRunResult, AgentTask, PlanStep, ToolObservation } from "./types.js";
import { analyzeLog } from "./tools/logAnalyzer.js";
import { analyzeTelemetry } from "./tools/sensorAnalyzer.js";
import { retrieveKnowledge } from "./tools/knowledgeRetriever.js";
import { adviseRepair } from "./tools/repairAdvisor.js";

export const sampleTask: AgentTask = {
  task: "ESP32 传感器节点运行 15 分钟后偶发重启，I2C 温湿度传感器读数间歇性失败，请定位原因并给出修复方案。",
  board: "ESP32-S3 + SHT31 + 5V USB 供电",
  serialLog: [
    "[00:14:58] sensor read ok temp=35.2 hum=48.3",
    "[00:15:02] i2c timeout on address 0x44",
    "[00:15:03] sensor invalid value nan",
    "[00:15:04] brownout detector was triggered",
    "[00:15:04] rst:0xc (SW_CPU_RESET), boot:0x8"
  ].join("\n"),
  telemetry: [
    { name: "vcc", value: 4.52, unit: "V" },
    { name: "current", value: 1.32, unit: "A" },
    { name: "temperature", value: 62.5, unit: "C" },
    { name: "i2c_error_rate", value: 0.087, unit: "" },
    { name: "packet_loss", value: 0.018, unit: "" }
  ]
};

export function planTask(task: AgentTask): PlanStep[] {
  return [
    {
      id: "step-1",
      title: "解析任务并锁定可观测证据",
      rationale: `板卡对象为 ${task.board}，优先分析日志中的复位与外设异常。`,
      tool: "log_analyzer"
    },
    {
      id: "step-2",
      title: "检查关键遥测是否越界",
      rationale: "用电压、电流、温度和通信错误率判断硬件链路风险。",
      tool: "sensor_analyzer"
    },
    {
      id: "step-3",
      title: "检索工程知识并形成假设",
      rationale: "把故障现象映射到电源、总线和热设计排查经验。",
      tool: "knowledge_retriever"
    },
    {
      id: "step-4",
      title: "生成修复动作和下一轮实验",
      rationale: "根据证据强度输出可执行的硬件与固件修改建议。",
      tool: "repair_advisor"
    }
  ];
}

export function runAgent(task: AgentTask): AgentRunResult {
  const plan = planTask(task);
  const observations: ToolObservation[] = [
    analyzeLog(task),
    analyzeTelemetry(task),
    retrieveKnowledge(task),
    adviseRepair(task)
  ];

  const criticalEvidence = observations
    .filter((item) => item.severity === "critical")
    .flatMap((item) => item.evidence);
  const warnings = observations
    .filter((item) => item.severity === "warning")
    .flatMap((item) => item.evidence);

  const rootCause = criticalEvidence.some((item) => /供电|5V|电源|vcc/i.test(item))
    ? "供电电压跌落触发 brownout，随后 I2C 读数失败并引发系统复位。"
    : warnings.some((item) => /I2C/i.test(item))
      ? "I2C 总线稳定性不足，可能由上拉、电容负载或速率配置导致。"
      : "当前证据不足以锁定单一根因，需要增加复现实验。";

  return {
    task,
    plan,
    observations,
    diagnosis: {
      rootCause,
      confidence: criticalEvidence.length ? 0.86 : warnings.length ? 0.68 : 0.42,
      actions: buildActions(observations),
      nextExperiment: "用示波器同时采集 5V/VCC 与 SCL/SDA，在外设启动和无线发送瞬间观察压降、毛刺与 ACK 丢失。"
    }
  };
}

function buildActions(observations: ToolObservation[]): string[] {
  const merged = observations.flatMap((item) => item.evidence);
  const actions = new Set<string>();

  if (merged.some((item) => /供电|5V|brownout|vcc/i.test(item))) {
    actions.add("更换短而粗的供电线，增加输入端 470uF 电容和芯片附近 0.1uF/10uF 去耦。");
    actions.add("把高功耗外设启动改为分时上电，避免 Wi-Fi 发射与传感器采样同时发生。");
  }
  if (merged.some((item) => /I2C|SCL|SDA|错误率/i.test(item))) {
    actions.add("把 I2C 速率降到 100kHz，复核上拉电阻与总线长度。");
  }
  if (merged.some((item) => /看门狗|watchdog|wdt/i.test(item))) {
    actions.add("为传感器读取任务增加超时退出和喂狗保护。");
  }

  return [...actions, "记录修复前后复位次数、I2C 错误率和供电最低值，形成比赛演示对比。"];
}
