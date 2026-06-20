import { spawn } from "node:child_process";
import path from "node:path";

const port = Number(process.env.SMOKE_PORT || 8791);
const baseUrl = `http://127.0.0.1:${port}`;
const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const requestedSuite = parseSuite();

const compileChecks = new Set([
  "closed loop without serial port",
  "conversation firmware task without serial port",
  "conversation board model selection",
  "conversation esp32-c3 board model selection",
  "conversation luatos esp32-c3 gpio firmware",
  "gpio validation blocks risky config"
]);

const allOnlyChecks = new Set([
  "conversation llm fallback"
]);

const server = spawn(process.execPath, [tsxCli, "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

const checks = [];

try {
  await waitForServer();

  await check("health", async () => {
    const data = await getJson("/api/health");
    assert(data.ok === true, "health endpoint did not return ok=true");
  });

  await check("esp environment", async () => {
    const data = await getJson("/api/esp/environment");
    assert(Boolean(data.pio_ok), "PlatformIO is not available");
    assert(Boolean(data.pyserial), "pyserial is not available");
  });

  await check("esp preflight", async () => {
    const data = await getJson("/api/esp/preflight");
    assert(data.ready_for_compile === true, "preflight compile readiness is false");
    assert(data.selftest?.success === true, "preflight self-test failed");
    assert(typeof data.ready_for_upload === "boolean", "preflight upload readiness should be boolean");
    assert(typeof data.next_step === "string" && data.next_step.length > 0, "preflight should provide a next step");
  });

  await check("manual pasted log diagnosis", async () => {
    const data = await postJson("/api/esp/diagnose-log", {
      log: "[BOOT] ESP closed-loop start\n[ERROR] AHT20 not found at 0x38"
    });
    assert(data.diagnosis?.root_cause === "aht20_i2c_fault", "manual log diagnosis mismatch");
    assert(data.observation?.success === false, "manual incomplete log should fail task observation");
    assert(data.steps?.some((step) => step.name === "task_observation_check"), "manual diagnosis should include task_observation_check step");
  });

  await check("conversation agent log diagnosis", async () => {
    const data = await postJson("/api/agent/chat", {
      message: "请诊断这段日志",
      log: "[BOOT] ESP closed-loop start\n[ERROR] AHT20 not found at 0x38"
    });
    assert(data.planner?.intent === "diagnose_log", "conversation planner should select log diagnosis");
    assert(data.tool_calls?.some((tool) => tool.name === "esp_diagnose_log"), "missing diagnose tool call");
    assert(data.result?.diagnosis?.root_cause === "aht20_i2c_fault", "chat diagnosis mismatch");
  });

  await check("conversation llm fallback", async () => {
    const data = await postJson("/api/agent/chat", {
      message: "OLED 显示失败，请调用 ESP 工具诊断",
      llm: {
        enabled: true,
        provider: "test-invalid",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "invalid-model",
        apiKey: "test-key"
      }
    });
    assert(data.planner?.mode === "rule_based_offline", "invalid LLM config should fall back to rule planner");
    assert(data.planner?.intent === "closed_loop" || data.planner?.intent === "firmware_task" || data.planner?.intent === "chat_only" || data.planner?.intent === "diagnose_log", "fallback planner should stay in supported intents");
  });

  await check("hardware task observation check", async () => {
    const log = [
      "[BOOT] ESP closed-loop start",
      "[PIN] SDA=8 SCL=9 LED=2 BUZZER=4 OLED_RES=-1 OLED_DC=-1",
      "[I2C] device found address=0x38",
      "[I2C] device found address=0x3C",
      "[OLED] init ok address=0x3C",
      "[AHT20] init ok address=0x38",
      "[DATA] temp=26.32C humidity=51.40%",
      "[OLED] display update line1=Temp: 26.32 C line2=Humi: 51.40 % line3=runtime OK",
      "[LED] state=ON reason=telemetry_ok",
      "[BUZZER] tone frequency=1200 duration_ms=120 reason=aht20_init_ok",
      "[SYSTEM] ok"
    ].join("\n");
    const data = await postJson("/api/esp/task-observation", { log });
    assert(data.success === true, "complete runtime log should pass observation");
    assert(data.passed === data.total, "observation passed count mismatch");
  });

  await check("serial probe api", async () => {
    const data = await postJson("/api/esp/probe-serial", { port: "COM999", baud: 115200 });
    assert(data.success === false, "COM999 probe should not succeed");
    assert(typeof data.message === "string" && data.message.length > 0, "serial probe should return an error message");
  });

  await check("closed loop without serial port", async () => {
    const data = await postJson("/api/esp/closed-loop", {
      project_name: "esp_smoke_test",
      port: "",
      flash_size: "16MB",
      memory_type: "qio_opi",
      partitions: "default_16MB.csv",
      sda_pin: 8,
      scl_pin: 9,
      oled_reset_pin: -1,
      oled_dc_pin: -1,
      led_pin: 2,
      buzzer_pin: 4
    });
    assert(data.steps?.some((step) => step.name === "generate_project" && step.result?.success === true), "project generation did not succeed");
    assert(data.steps?.some((step) => step.name === "compile" && step.result?.success === true), "PlatformIO compile did not succeed");
    assert(data.steps?.some((step) => step.name === "flash" && step.result?.success === null), "flash step should be skipped without a port");
  });

  await check("conversation firmware task without serial port", async () => {
    const data = await postJson("/api/agent/chat", {
      message: "点亮 LED，不连接串口时只生成并编译固件",
      closedLoop: {
        project_name: "esp_smoke_led_task",
        port: "",
        flash_size: "16MB",
        memory_type: "qio_opi",
        partitions: "default_16MB.csv",
        sda_pin: 8,
        scl_pin: 9,
        oled_reset_pin: -1,
        oled_dc_pin: -1,
        led_pin: 2,
        buzzer_pin: 4
      }
    });
    assert(data.planner?.intent === "firmware_task", "conversation planner should select firmware_task");
    assert(data.tool_calls?.some((tool) => tool.name === "compile_and_flash_generated_firmware"), "missing firmware task tool call");
    assert(data.result?.steps?.some((step) => step.name === "generate_firmware_task" && step.result?.success === true), "firmware task generation did not succeed");
    assert(data.result?.steps?.some((step) => step.name === "compile" && step.result?.success === true), "firmware task compile did not succeed");
    assert(data.result?.steps?.some((step) => step.name === "flash" && step.result?.success === null), "firmware task flash step should be skipped without a port");
  });

  await check("conversation board model selection", async () => {
    const data = await postJson("/api/agent/chat", {
      message: "用普通 ESP32 DevKit V1 点亮 LED，不连接串口时只生成并编译固件",
      closedLoop: {
        project_name: "esp32_classic_smoke_led_task",
        board_model: "esp32-devkit-v1",
        port: "",
        sda_pin: 21,
        scl_pin: 22,
        oled_reset_pin: -1,
        oled_dc_pin: -1,
        led_pin: 2,
        buzzer_pin: 4
      }
    });
    const generateStep = data.result?.steps?.find((step) => step.name === "generate_firmware_task");
    assert(data.planner?.intent === "firmware_task", "conversation planner should select firmware_task");
    assert(generateStep?.result?.board?.board_model === "esp32-devkit-v1", "firmware task should resolve ESP32 DevKit V1 board model");
    assert(generateStep?.result?.board?.board === "esp32doit-devkit-v1", "firmware task should use PlatformIO esp32doit-devkit-v1");
    assert(generateStep?.result?.board?.usb_cdc === false, "classic ESP32 preset should not force USB CDC");
  });

  await check("conversation esp32-c3 board model selection", async () => {
    const data = await postJson("/api/agent/chat", {
      message: "用 ESP32-C3 DevKitM-1 点亮 LED，不连接串口时只生成并编译固件",
      closedLoop: {
        project_name: "esp32_c3_smoke_led_task",
        board_model: "esp32-c3-devkitm-1",
        port: "",
        sda_pin: 8,
        scl_pin: 9,
        oled_reset_pin: -1,
        oled_dc_pin: -1,
        led_pin: 2,
        buzzer_pin: 4
      }
    });
    const generateStep = data.result?.steps?.find((step) => step.name === "generate_firmware_task");
    assert(data.planner?.intent === "firmware_task", "conversation planner should select firmware_task");
    assert(generateStep?.result?.board?.board_model === "esp32-c3-devkitm-1", "firmware task should resolve ESP32-C3 board model");
    assert(generateStep?.result?.board?.board === "esp32-c3-devkitm-1", "firmware task should use PlatformIO esp32-c3-devkitm-1");
    assert(generateStep?.result?.board?.psram === false, "ESP32-C3 preset should not enable PSRAM");
  });

  await check("conversation luatos esp32-c3 gpio firmware", async () => {
    const data = await postJson("/api/agent/chat", {
      message: "Use LuatOS ESP32C3 core board. Make GPIO4 and GPIO5 alternate every 1s.",
      closedLoop: {
        project_name: "luatos_c3_gpio45_smoke",
        board_model: "luatos-esp32c3-core",
        port: "",
        sda_pin: 8,
        scl_pin: 9,
        oled_reset_pin: -1,
        oled_dc_pin: -1,
        led_pin: 2,
        buzzer_pin: 4
      }
    });
    const generateStep = data.result?.steps?.find((step) => step.name === "generate_firmware_task");
    assert(data.planner?.intent === "firmware_task", "GPIO command should select firmware_task");
    assert(generateStep?.result?.board?.board_model === "luatos-esp32c3-core", "LuatOS ESP32C3 preset should be selected");
    assert(generateStep?.result?.board?.flash_mode === "dio", "LuatOS ESP32C3 preset should use DIO flash mode");
    assert(generateStep?.result?.board?.usb_cdc === false, "LuatOS ESP32C3 preset should not force USB CDC");
    assert(generateStep?.result?.task === "custom", "GPIO natural language command should generate custom firmware");
    assert(data.result?.steps?.some((step) => step.name === "compile" && step.result?.success === true), "LuatOS GPIO firmware should compile");
  });

  await check("gpio validation blocks risky config", async () => {
    const data = await postJson("/api/esp/closed-loop", {
      project_name: "esp_gpio_bad_smoke",
      port: "",
      flash_size: "16MB",
      memory_type: "qio_opi",
      partitions: "default_16MB.csv",
      sda_pin: 8,
      scl_pin: 8,
      oled_reset_pin: -1,
      oled_dc_pin: -1,
      led_pin: 26,
      buzzer_pin: 4
    });
    assert(data.success === false, "risky GPIO config should fail before generation");
    assert(data.diagnosis?.root_cause === "gpio_configuration_invalid", "GPIO failure root cause mismatch");
    assert(Array.isArray(data.steps) && data.steps.length === 1 && data.steps[0].name === "validate_gpio", "GPIO failure should stop at validate_gpio");
  });

  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, checks, error: error instanceof Error ? error.message : String(error), serverLog }, null, 2));
  process.exitCode = 1;
} finally {
  server.kill();
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await getJson("/api/health");
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`server did not become ready on ${baseUrl}`);
}

async function check(name, fn) {
  const suite = compileChecks.has(name) ? "compile" : allOnlyChecks.has(name) ? "all" : "api";
  if (!shouldRunSuite(suite)) {
    checks.push({ name, ok: true, skipped: true, suite });
    return;
  }
  const started = Date.now();
  try {
    await fn();
    checks.push({ name, ok: true, suite, duration_ms: Date.now() - started });
  } catch (error) {
    checks.push({ name, ok: false, suite, duration_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function parseSuite() {
  const suiteArg = process.argv.find((arg) => arg.startsWith("--suite="));
  const value = suiteArg?.slice("--suite=".length) || process.env.SMOKE_SUITE || "api";
  if (!["api", "compile", "all"].includes(value)) {
    throw new Error(`Unsupported smoke suite "${value}". Use api, compile, or all.`);
  }
  return value;
}

function shouldRunSuite(suite) {
  if (requestedSuite === "all") return true;
  return suite === requestedSuite;
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function postJson(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

