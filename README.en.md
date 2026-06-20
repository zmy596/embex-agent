# Embex: Memory-Augmented Closed-Loop Compile and Debug Platform for ESP Development

Embex is a memory-augmented agent platform for ESP-series embedded development. It turns natural-language hardware tasks into a closed-loop workflow: task understanding, ReAct planning, model-owned `main.cpp` generation, PlatformIO build, upload, serial observation, log diagnosis, task acceptance, and revision.

Embex is not a fixed demo generator. The model owns the firmware logic, while helper libraries such as `agent_peripherals` are optional support tools.

## Features

- Web chat interface for natural-language hardware tasks.
- Model-driven ESP Arduino `main.cpp` generation.
- PlatformIO project generation.
- Automatic compile, upload, and serial monitor.
- Diagnosis based on compile errors, upload errors, serial logs, and hardware observations.
- Hardware configuration for board model, serial port, peripherals, pins, and protocols.
- Local RAG knowledge base for ESP boards, GPIO rules, peripherals, and debugging experience.
- Long-term memory and context compression for hardware state, user preferences, project facts, and failure cases.
- Skill / MCP extension layer for pin analysis, project analysis, filesystem, Git, and serial hardware tools.

## Supported Targets

Boards and chips:

- ESP32
- ESP32-S3
- ESP32-C3
- ESP8266
- Compatible boards such as LuatOS ESP32-C3 Core

Typical peripherals:

- OLED, including I2C OLED and 6-pin SPI OLED
- LED
- Passive buzzer
- AHT20
- DHT11
- BH1750
- Generic GPIO peripherals

## Repository Layout

| Path | Description |
|---|---|
| `src/` | React Web UI |
| `server/` | Express API, agent orchestration, RAG, memory, Skill/MCP |
| `server/langchainEspAgent.ts` | ReAct-style ESP agent |
| `server/conversationAgent.ts` | Conversation entry, task routing, memory and knowledge integration |
| `esp_agent/tools/` | Python tool layer for PlatformIO, serial, GPIO validation, and diagnosis |
| `esp_agent/knowledge/` | Board pinouts and local RAG knowledge base |
| `memory/` | Local memory directory metadata |
| `scripts/` | Smoke tests, hardware readiness checks, serial probe, and verification scripts |
| `docs/` | GitHub reproducibility, upload, and competition notes |

## Quick Start

### 1. Clone

```powershell
git clone https://github.com/<your-name>/embex.git
cd embex
```

### 2. Setup

Recommended on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

Manual setup:

```powershell
npm install
python -m pip install -r requirements.txt
```

For strict Node dependency reproduction:

```powershell
npm ci
```

### 3. Configure Model Access

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```text
LLM_ENABLED=true
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=<your-model>
LLM_API_KEY=<your-api-key>
```

You can also configure the model in the Web Model page. Do not commit `.env`.

### 4. Start

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Default services:

| Service | URL |
|---|---|
| Web UI | `http://127.0.0.1:5173/` |
| API | `http://127.0.0.1:8787/` |

## Environment

Python dependencies:

```text
platformio==6.1.19
pyserial==3.5
```

Conda environment:

```powershell
conda env create -f environment.yml
```

Optional Python runtime override:

```powershell
$env:ESP_AGENT_PYTHON="D:\code\anaconda\envs\yd-agent\python.exe"
```

## Verification

Build:

```powershell
npm run build
```

API smoke:

```powershell
npm run smoke:api
```

Integrated RAG / memory / Skill / MCP smoke:

```powershell
npm run integration:smoke
```

Hardware readiness:

```powershell
npm run hardware:preflight
npm run hardware:readiness
npm run hardware:usb
```

Serial probe:

```powershell
npm run serial:probe -- --port COM12
```

Full verification:

```powershell
npm run verify
```

Hardware verification depends on the connected board, USB-UART driver, serial port, and wiring.

## Example Tasks

OLED:

```text
让 6pin SPI OLED 显示 China，并在串口打印 OLED 初始化结果。
```

LED:

```text
让 GPIO12 上的 LED 每 500ms 闪烁一次，并通过串口输出心跳日志。
```

Sensor:

```text
读取 AHT20 温湿度并输出到串口，如果读取失败请自动诊断。
```

Log diagnosis:

```text
请诊断这段烧录日志：Invalid head of packet 0x45
```

## Competition Reproducibility

- `docs/competition/reproducible-software-artifact.zh-CN.md`
- `docs/competition/dependencies.zh-CN.md`
- `docs/REPRODUCIBILITY.md`
- `docs/GITHUB_UPLOAD.md`
- `docs/COMPETITION_SUBMISSION.md`

## Why Local Execution Is Needed

Embex can be demonstrated as a public Web application, but the full ESP compile/upload/serial loop needs access to the user's local COM port and board. The full hardware loop should be reproduced locally after cloning the GitHub repository.

Recommended release model:

```text
GitHub repository: source code, docs, reproducibility scripts
Local run: full PlatformIO compile/upload/serial loop
Public demo: Web UI, RAG, memory, log diagnosis, software-only workflows
```

## Security

- Never commit `.env` or API keys.
- Do not commit `node_modules/`, `dist/`, `runs/`, temporary firmware projects, or local logs.
- Review serial logs before publishing them.
- Confirm board model, serial port, power, GND, boot pins, and peripheral wiring before flashing.

## License

MIT License. See [LICENSE](LICENSE).

