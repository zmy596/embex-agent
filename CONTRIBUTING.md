# Contributing to Embex

Thanks for your interest in Embex.

## Development Setup

```powershell
git clone https://github.com/<your-name>/embex.git
cd embex
powershell -ExecutionPolicy Bypass -File setup.ps1
npm run dev
```

## Before Submitting Changes

Run:

```powershell
npm run build
npm run smoke:api
npm run integration:smoke
```

For hardware-related changes, also run:

```powershell
npm run hardware:preflight
```

## Contribution Scope

Good contribution areas:

- board pinout knowledge
- peripheral documentation
- ESP compile/upload diagnostics
- RAG documents
- memory compression
- Skill/MCP capabilities
- UI improvements
- reproducibility docs

## Coding Principles

- Keep model-owned `main.cpp` generation explicit.
- Do not silently fall back to unrelated firmware templates.
- Treat tool failure as an observation for the agent.
- Keep hardware state and user-configured peripherals separate from task-specific usage.
- Do not commit API keys, serial logs with private data, or generated build artifacts.

