export type ToolName =
  | "log_analyzer"
  | "sensor_analyzer"
  | "knowledge_retriever"
  | "repair_advisor";

export interface AgentTask {
  task: string;
  board: string;
  serialLog: string;
  telemetry: TelemetryPoint[];
}

export interface TelemetryPoint {
  name: string;
  value: number;
  unit: string;
}

export interface PlanStep {
  id: string;
  title: string;
  rationale: string;
  tool: ToolName;
}

export interface ToolObservation {
  tool: ToolName;
  title: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  evidence: string[];
  recommendation: string;
}

export interface AgentRunResult {
  task: AgentTask;
  plan: PlanStep[];
  observations: ToolObservation[];
  diagnosis: {
    rootCause: string;
    confidence: number;
    actions: string[];
    nextExperiment: string;
  };
}
