import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveEspPython() {
  const candidates = [
    process.env.ESP_AGENT_PYTHON,
    "D:\\code\\anaconda\\envs\\yd-agent\\python.exe",
    path.join(os.homedir(), ".conda", "envs", "yd-agent", "python.exe"),
    process.env.CONDA_PREFIX && path.join(process.env.CONDA_PREFIX, "python.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "python";
}

export function pythonEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
    ...extra
  };
}
