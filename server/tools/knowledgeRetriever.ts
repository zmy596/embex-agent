import type { AgentTask, ToolObservation } from "../types.js";

const knowledge = [
  {
    keyword: /brown[- ]?out|undervoltage|vcc|电源|复位/i,
    title: "电源跌落排查知识",
    advice: "检查稳压器余量、USB 线压降、去耦电容、负载启动电流和 BOR 阈值配置。"
  },
  {
    keyword: /i2c|sda|scl|nack|timeout/i,
    title: "I2C 总线排查知识",
    advice: "核对上拉电阻、总线电容、设备地址、时钟频率，并用逻辑分析仪观察 ACK 时序。"
  },
  {
    keyword: /uart|serial|串口/i,
    title: "串口链路排查知识",
    advice: "确认波特率、校验位、DMA 缓冲区大小和中断优先级，避免日志阻塞实时任务。"
  },
  {
    keyword: /temperature|温度|过热/i,
    title: "热设计排查知识",
    advice: "检查功耗器件布局、散热路径、环境温度和高负载算法任务的占空比。"
  }
];

export function retrieveKnowledge(task: AgentTask): ToolObservation {
  const text = `${task.task}\n${task.serialLog}\n${task.telemetry.map((p) => p.name).join(" ")}`;
  const matched = knowledge.filter((item) => item.keyword.test(text));

  return {
    tool: "knowledge_retriever",
    title: "工程知识检索",
    severity: "info",
    summary: matched.length
      ? `召回 ${matched.length} 条相关工程经验。`
      : "未召回强相关知识条目，使用通用嵌入式排查流程。",
    evidence: matched.length ? matched.map((item) => item.title) : ["通用流程：电源、时钟、通信、外设、任务调度"],
    recommendation: matched.length
      ? matched.map((item) => item.advice).join(" ")
      : "按硬件供电、时钟配置、通信链路、外设初始化和 RTOS 调度顺序排查。"
  };
}
