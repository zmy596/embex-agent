import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { resolveEspPython, pythonEnv } from "./runtime-env.mjs";

const pythonCommand = resolveEspPython();
const logPath = process.argv[2];

if (!logPath) {
  console.error("Usage: npm run task:observe -- <serial-log.txt>");
  process.exit(2);
}

if (!fs.existsSync(logPath)) {
  console.error(`Serial log file not found: ${logPath}`);
  process.exit(2);
}

const log = fs.readFileSync(logPath, "utf-8");
const script = [
  "import json, sys",
  "sys.path.insert(0, 'esp_agent/tools')",
  "from esp_platformio_tools import esp32_task_observation_check, esp_diagnose_log",
  "log=sys.stdin.read()",
  "print(json.dumps({'observation': esp32_task_observation_check(log), 'diagnosis': esp_diagnose_log(log)}, ensure_ascii=False))"
].join("\n");

const result = spawnSync(pythonCommand, ["-c", script], {
  cwd: process.cwd(),
  input: log,
  env: pythonEnv(),
  encoding: "utf-8"
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout);
console.log(JSON.stringify(payload, null, 2));
process.exit(payload.observation?.success ? 0 : 1);
