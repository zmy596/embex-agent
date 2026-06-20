import { spawnSync } from "node:child_process";
import { resolveEspPython, pythonEnv } from "./runtime-env.mjs";

const pythonCommand = resolveEspPython();
const args = parseArgs(process.argv.slice(2));
const port = args.port;
const baud = Number(args.baud || 115200);

if (!port) {
  console.error("Usage: npm run serial:probe -- --port COM15 [--baud 115200]");
  process.exit(2);
}

const script = [
  "import json, sys, time",
  "payload=json.loads(sys.stdin.read() or '{}')",
  "result={'success': False, 'port': payload.get('port'), 'baud': payload.get('baud')}",
  "try:",
  "    import serial",
  "    ser = serial.Serial(port=payload.get('port'), baudrate=int(payload.get('baud') or 115200), timeout=0.2)",
  "    time.sleep(0.2)",
  "    result.update({'success': True, 'is_open': ser.is_open, 'message': 'Serial port opened successfully.'})",
  "    ser.close()",
  "except Exception as exc:",
  "    result.update({'success': False, 'message': str(exc), 'error_type': type(exc).__name__})",
  "print(json.dumps(result, ensure_ascii=False))"
].join("\n");

const result = spawnSync(pythonCommand, ["-c", script], {
  cwd: process.cwd(),
  input: JSON.stringify({ port, baud }),
  env: pythonEnv(),
  encoding: "utf-8",
  timeout: 30_000
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout);
console.log(JSON.stringify(payload, null, 2));
process.exit(payload.success ? 0 : 1);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-/g, "_");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = "true";
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}
