import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveEspPython, pythonEnv } from "./runtime-env.mjs";

const pythonCommand = resolveEspPython();
const schemaPath = path.join(process.cwd(), "esp_agent", "tools", "schemas.json");
const skillReadmePath = path.join(process.cwd(), "esp_agent", "tools", "README.md");
const skillPromptPath = path.join(process.cwd(), "esp_agent", "tools", "prompt.md");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

const script = [
  "import inspect, json, sys",
  "sys.path.insert(0, 'esp_agent/tools')",
  "import esp_platformio_tools as tools",
  "payload = {}",
  "for name, fn in tools.TOOLS_MAP.items():",
  "    sig = inspect.signature(fn)",
  "    payload[name] = {",
  "        'params': [p.name for p in sig.parameters.values()],",
  "        'required': [p.name for p in sig.parameters.values() if p.default is inspect._empty],",
  "    }",
  "print(json.dumps(payload, ensure_ascii=False))"
].join("\n");

const result = spawnSync(pythonCommand, ["-c", script], {
  cwd: process.cwd(),
  env: pythonEnv(),
  encoding: "utf-8"
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const toolsMap = JSON.parse(result.stdout);
const schemaTools = schema.tools || [];
const failures = [];
const skillReadme = fs.readFileSync(skillReadmePath, "utf-8");
const skillPrompt = fs.readFileSync(skillPromptPath, "utf-8");

if (!Array.isArray(schemaTools) || schemaTools.length === 0) {
  failures.push("schemas.json must contain a non-empty tools array");
}

const requiredDocSnippets = [
  "ESP board",
  "ESP8266",
  "flash_size=16MB",
  "memory_type=qio_opi",
  "default_16MB.csv",
  "esp_task_observation_check",
  "[I2C] device found address=0x38",
  "[I2C] device found address=0x3C",
];

for (const snippet of requiredDocSnippets) {
  if (!skillReadme.includes(snippet) && !skillPrompt.includes(snippet)) {
    failures.push(`skill README/prompt missing required snippet: ${snippet}`);
  }
}

const schemaByName = new Map();
for (const entry of schemaTools) {
  if (entry?.type !== "function") {
    failures.push(`schema entry has invalid type: ${JSON.stringify(entry)}`);
    continue;
  }
  const fn = entry.function || {};
  if (!fn.name) {
    failures.push("schema function entry is missing name");
    continue;
  }
  if (schemaByName.has(fn.name)) {
    failures.push(`duplicate schema tool: ${fn.name}`);
  }
  schemaByName.set(fn.name, fn);
  if (!fn.description || fn.description.length < 12) {
    failures.push(`${fn.name} is missing a useful description`);
  }
  if (fn.parameters?.type !== "object") {
    failures.push(`${fn.name} parameters.type must be object`);
  }
  if (!fn.parameters?.properties) {
    failures.push(`${fn.name} parameters.properties is missing`);
  }
}

const toolsMapNames = Object.keys(toolsMap).sort();
const schemaNames = [...schemaByName.keys()].sort();
const expectedSchemaDefaults = {
  esp_generate_project: {
    flash_size: "16MB",
    memory_type: "qio_opi",
    partitions: "default_16MB.csv"
  },
  esp_run_closed_loop: {
    flash_size: "16MB",
    memory_type: "qio_opi",
    partitions: "default_16MB.csv"
  }
};

for (const name of toolsMapNames) {
  if (!schemaByName.has(name)) {
    failures.push(`${name} exists in TOOLS_MAP but is missing from schemas.json`);
  }
}

for (const name of schemaNames) {
  if (!toolsMap[name]) {
    failures.push(`${name} exists in schemas.json but is missing from TOOLS_MAP`);
    continue;
  }

  const fn = schemaByName.get(name);
  const schemaProps = Object.keys(fn.parameters?.properties || {});
  const pythonParams = toolsMap[name].params || [];
  const schemaRequired = fn.parameters?.required || [];
  const pythonRequired = toolsMap[name].required || [];

  for (const param of pythonParams) {
    if (!schemaProps.includes(param)) {
      failures.push(`${name}.${param} exists in Python signature but is missing from schema properties`);
    }
  }
  for (const prop of schemaProps) {
    if (!pythonParams.includes(prop)) {
      failures.push(`${name}.${prop} exists in schema properties but is missing from Python signature`);
    }
  }
  for (const required of pythonRequired) {
    if (!schemaRequired.includes(required)) {
      failures.push(`${name}.${required} is required in Python but not marked required in schema`);
    }
  }
  for (const required of schemaRequired) {
    if (!pythonRequired.includes(required)) {
      failures.push(`${name}.${required} is required in schema but optional in Python`);
    }
  }
  for (const [prop, expectedDefault] of Object.entries(expectedSchemaDefaults[name] || {})) {
    const actualDefault = fn.parameters?.properties?.[prop]?.default;
    if (actualDefault !== expectedDefault) {
      failures.push(`${name}.${prop} default expected ${expectedDefault}, got ${actualDefault}`);
    }
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ success: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  success: true,
  tools: schemaNames,
  count: schemaNames.length
}, null, 2));
