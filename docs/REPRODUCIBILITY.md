# Reproducibility Guide

This document describes how to reproduce Embex as a software artifact and how to verify its core functions.

## 1. Required Files

A reproducible Embex checkout should include:

- `package.json`
- `package-lock.json`
- `requirements.txt`
- `environment.yml`
- `.env.example`
- `src/`
- `server/`
- `esp_agent/`
- `scripts/`
- `memory/README.md`
- `esp_agent/knowledge/rag/README.md`
- `esp_agent/knowledge/rag/documents/*.md`
- `esp_agent/knowledge/board_pinouts/boards.json`

Do not require checked-in `node_modules/`, `dist/`, `.env`, or local `runs/` outputs.

## 2. Setup

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

Manual setup:

```powershell
npm ci
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` or use the Web Model page to configure an OpenAI-compatible model endpoint.

## 3. Start Services

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## 4. Software-Only Verification

```powershell
npm run build
npm run smoke:api
npm run integration:smoke
npm run knowledge:smoke
npm run memory:smoke
npm run skill:smoke
npm run mcp:smoke
```

These checks verify:

- TypeScript build
- API health
- ESP environment detection
- local RAG retrieval
- memory persistence
- Skill/MCP registry and invocation
- conversation-agent basic routes

## 5. Hardware Verification

Before flashing hardware:

```powershell
npm run hardware:preflight
npm run hardware:readiness
npm run serial:probe -- --port COM12
```

Then use the Web Hardware page to set:

- board model,
- serial port,
- connected peripherals,
- pins,
- protocol such as I2C or SPI.

Example task:

```text
让 GPIO12 上的 LED 每 500ms 闪烁一次，并通过串口输出心跳日志。
```

Expected workflow:

```text
Task -> Plan -> Generate main.cpp -> Build -> Flash -> Monitor serial -> Verify -> Summarize
```

## 6. Result Evidence

For competition or review, save:

- task text,
- hardware configuration,
- generated `main.cpp` summary,
- compile log,
- upload result,
- serial log,
- model acceptance result,
- user-observed hardware phenomenon.

Recommended location:

```text
比赛提交材料/测试结果汇总.md
```

## 7. Known Limits

- A public Web deployment cannot directly access a user's local COM port.
- Full hardware closed-loop execution should be reproduced locally.
- Model output quality depends on the configured model endpoint and API key.
- PlatformIO first build may take longer due to dependency downloads.

