import { spawn } from "node:child_process";
import { resolveEspPython, pythonEnv } from "./runtime-env.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pythonCommand = resolveEspPython();

const checks = [
  {
    name: "python py_compile",
    command: pythonCommand,
    args: ["-m", "py_compile", "esp_agent/tools/esp_platformio_tools.py"]
  },
  {
    name: "esp tools selftest",
    command: pythonCommand,
    args: ["esp_agent/tools/selftest.py"]
  },
  {
    name: "skill contract",
    command: npmCommand,
    args: ["run", "skill:verify"]
  },
  {
    name: "hardware preflight",
    command: npmCommand,
    args: ["run", "hardware:preflight"]
  },
  {
    name: "hardware readiness report",
    command: npmCommand,
    args: ["run", "hardware:readiness"]
  },
  {
    name: "usb uart pnp diagnosis",
    command: npmCommand,
    args: ["run", "hardware:usb"]
  },
  {
    name: "hardware auto-port guard",
    command: npmCommand,
    args: ["run", "hardware:run", "--", "--auto-port", "--out", ".tmp-hardware-auto-port-verify"]
  },
  {
    name: "hardware run artifact",
    command: npmCommand,
    args: ["run", "hardware:run", "--", "--project", "esp_verify_artifact", "--out", ".tmp-hardware-run-verify"]
  },
  {
    name: "typecheck",
    command: npmCommand,
    args: ["run", "typecheck"]
  },
  {
    name: "build",
    command: npmCommand,
    args: ["run", "build"]
  },
  {
    name: "smoke api",
    command: npmCommand,
    args: ["run", "smoke:api"]
  }
];

const results = [];

for (const item of checks) {
  const result = await runCheck(item);
  results.push(result);
  if (!result.success) {
    console.error(JSON.stringify({ success: false, failed: result.name, results }, null, 2));
    process.exit(1);
  }
}

console.log(JSON.stringify({ success: true, results }, null, 2));

function runCheck({ name, command, args }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const spawnCommand = process.platform === "win32" ? "cmd.exe" : command;
    const spawnArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", quoteCommand([command, ...args])]
      : args;
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: process.cwd(),
      env: pythonEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        name,
        success: false,
        duration_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("close", (code) => {
      resolve({
        name,
        success: code === 0,
        exit_code: code,
        duration_ms: Date.now() - started,
        stdout_tail: tail(stdout),
        stderr_tail: tail(stderr)
      });
    });
  });
}

function quoteCommand(parts) {
  return parts.map((part) => {
    const value = String(part);
    if (/^[A-Za-z0-9_./:=\\-]+$/.test(value)) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
  }).join(" ");
}

function tail(value) {
  const lines = String(value || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-20).join("\n");
}
