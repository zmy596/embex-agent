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
| `docs/` | Project structure, reproducibility, upload, and release checklist notes |

For a fuller directory guide, see [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).

The repository root is reserved for project entry points, dependency manifests, build configuration, and top-level source directories. Contribution, security, and conduct documents live under `.github/`; release file lists live under `docs/`. This keeps the root directory concise and predictable.

## Quick Start

### 1. Clone

```powershell
git clone https://github.com/zmy596/embex-agent.git
cd embex-agent
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

## Full Environment Setup Chain

Embex dependencies are split into three layers: Node/TypeScript, Python/PlatformIO, and ESP low-level toolchains. Recommended setup:

```powershell
cd Embex-GitHub-Release
npm install
python -m pip install -r requirements.txt
Copy-Item .env.example .env
npm run dev
```

For strict Node dependency reproduction:

```powershell
npm ci
```

Dependency responsibility:

| File or mechanism | Purpose |
|---|---|
| `package.json` | Web UI, Express backend, LangChain JS, React, Vite, TypeScript, and other Node dependencies |
| `package-lock.json` | Locked Node dependency versions |
| `requirements.txt` | Python tool-layer dependencies, including PlatformIO and pyserial |
| `environment.yml` | Optional Conda environment description; not required by the default setup path |
| First PlatformIO build | Automatically downloads ESP platform packages, Arduino framework, esptool, RISC-V/Xtensa toolchains, and board support packages |

`requirements.txt` only records Python dependencies. LangChain is used through the JavaScript/TypeScript packages declared in `package.json`.

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

## Competition Submission and Reproducibility

Project title:

```text
Embex: Memory-Augmented Agentic Closed-Loop Compile and Debug Platform for ESP Development
```

Embex is positioned as an agentic closed-loop development platform for ESP-series embedded systems. It combines a Web interface, LLM-driven ReAct decisions, local RAG knowledge, long-term memory, Skill/MCP capabilities, and the PlatformIO toolchain to complete the loop from natural-language task input to firmware generation, build, upload, serial observation, log diagnosis, task acceptance, and revision.

### Competition Highlights

- Memory augmentation: persists hardware state, conversation history, user preferences, project facts, failure cases, and verified results, while using context compression to reduce long-session noise.
- RAG knowledge base: stores ESP board knowledge, GPIO risk rules, peripheral notes, PlatformIO workflows, upload failures, serial issues, watchdog, brownout, and debugging experience.
- Skill / MCP extension layer: exposes pin analysis, project scanning, serial tools, Git, filesystem, and log diagnosis as manageable and traceable capabilities.
- Model-owned firmware: the model generates `main.cpp` according to the task and hardware configuration; helper libraries only provide optional driver functions instead of replacing model decisions with fixed demos.
- Closed-loop toolchain: connects PlatformIO project generation, build, upload, serial monitoring, log diagnosis, and task acceptance into one ReAct workflow.
- Traceable execution: the Web UI displays stages, tool calls, failed nodes, serial observations, and acceptance decisions for reproducibility and presentation.

### Reproducible Software Artifact Scope

This repository contains the reproducible software artifact:

| Content | Files or directories |
|---|---|
| Web frontend | `src/` |
| Backend API and agent orchestration | `server/` |
| ESP tool layer | `esp_agent/tools/` |
| Initial RAG knowledge base | `esp_agent/knowledge/rag/documents/` |
| Board pinout knowledge | `esp_agent/knowledge/board_pinouts/`, `public/pinouts/` |
| Skill / MCP registry and implementations | `server/skills/`, `server/mcp/`, `esp_agent/skills/` |
| Local memory directory metadata | `memory/` |
| Verification scripts | `scripts/` |
| Dependencies and setup | `package.json`, `package-lock.json`, `requirements.txt`, `environment.yml`, `setup.ps1` |

The repository intentionally excludes `.env`, `node_modules/`, `dist/`, `runs/`, temporary firmware projects, serial logs, and local large files. Reviewers should reproduce dependencies and build artifacts through the documented commands.

For release include/exclude rules, see [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). For the current release snapshot, see [docs/RELEASE_FILE_LIST.txt](docs/RELEASE_FILE_LIST.txt).

### Suggested Acceptance Steps

```powershell
npm install
python -m pip install -r requirements.txt
Copy-Item .env.example .env
npm run build
npm run smoke:api
npm run integration:smoke
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

With a real ESP board connected:

```powershell
npm run hardware:preflight
npm run hardware:readiness
npm run serial:probe -- --port COM12
```

The full hardware loop requires local USB serial access, board drivers, the target board, and correct wiring. A public Web deployment cannot directly access a user's local COM port, so the complete build/upload/serial loop should be reproduced locally.

### Submission Notes

- Put source code, README files, dependency files, setup scripts, knowledge samples, verification scripts, and `.github/` community files in the GitHub repository.
- Submit papers, videos, slides, screenshots, and large attachments through the competition submission system or GitHub Releases instead of committing large binaries to the main repository history.
- A recommended demo should cover the Web UI, hardware configuration, model planning, `main.cpp` generation, build/upload, serial observation, failure diagnosis, and RAG/memory/Skill/MCP pages.
- Without hardware on site, reviewers can still inspect log diagnosis, knowledge retrieval, memory state, Skill/MCP invocation, and software smoke tests; the full closed loop is reproduced with local hardware.

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
