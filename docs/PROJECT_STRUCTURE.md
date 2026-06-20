# Project Structure

This repository is organized as a reproducible Embex software artifact. The root directory keeps only standard project entry files, dependency manifests, build configuration, Git/editor configuration, and top-level source directories. Implementation code, tools, documents, community files, and runtime data are grouped by responsibility.

## Top-Level Layout

```text
Embex-GitHub-Release/
├─ .github/                  GitHub templates and community documents
├─ docs/                     Project documentation, release checklist, reproducibility notes
├─ esp_agent/                Python ESP tool layer and embedded knowledge assets
├─ memory/                   Local memory directory metadata; runtime memory is ignored
├─ public/                   Static frontend assets, including board pinout text assets
├─ scripts/                  Smoke tests, hardware checks, serial probes, verification scripts
├─ server/                   Express backend, agent orchestration, RAG, memory, Skill/MCP
├─ src/                      React frontend source
├─ .editorconfig             Shared editor formatting rules
├─ .env.example              Environment variable template; copy to .env locally
├─ .gitattributes            Git text/binary and line-ending rules
├─ .gitignore                Git ignore rules for secrets, builds, logs, and runtime outputs
├─ package.json              Node/TypeScript dependencies and npm scripts
├─ package-lock.json         Locked Node dependency versions
├─ requirements.txt          Python tool-layer dependencies
├─ environment.yml           Optional Conda environment description
├─ setup.ps1                 Windows setup script
├─ vite.config.ts            Vite frontend dev server and proxy configuration
└─ README*.md                Main project documentation in Chinese and English
```

## Root Directory Policy

The root directory is kept for project entry points and toolchain manifests only:

- README entry files and license;
- Node, TypeScript, Vite, Python, Conda, and setup manifests;
- Git and editor configuration files;
- top-level implementation directories such as `src/`, `server/`, `esp_agent/`, and `scripts/`.

GitHub community files are stored under `.github/` to keep the root focused while remaining discoverable by GitHub. Generated release metadata such as `RELEASE_FILE_LIST.txt` is stored under `docs/`.

## Source Code

| Path | Responsibility |
|---|---|
| `src/` | React Web UI and browser-side interaction logic |
| `server/index.ts` | Express API entry point |
| `server/conversationAgent.ts` | Conversation entry, task routing, memory and knowledge integration |
| `server/langchainEspAgent.ts` | ReAct-style model agent and ESP tool calling |
| `server/knowledge/` | Local RAG indexing and retrieval |
| `server/memory/` | Persistent memory store |
| `server/skills/` | Skill registry and built-in skills |
| `server/mcp/` | MCP-style capability registry and implementations |
| `server/tools/` | Local diagnostic helper tools |

## ESP Tooling

| Path | Responsibility |
|---|---|
| `esp_agent/tools/` | Python PlatformIO, serial, GPIO validation, and firmware tooling |
| `esp_agent/tools/esp_platformio_tools.py` | Main Python bridge for PlatformIO project generation, compile, upload, and serial monitor |
| `esp_agent/tools/prompt.md` | Firmware-generation and tool-use rules |
| `esp_agent/tools/schemas.json` | Tool argument and result schemas |
| `esp_agent/knowledge/board_pinouts/` | Structured board pinout knowledge |
| `esp_agent/knowledge/rag/documents/` | Initial local RAG documents |
| `esp_agent/skills/` | Skill registry data used by the ESP agent layer |

## Static and Runtime Data

| Path | Responsibility |
|---|---|
| `public/pinouts/` | Frontend-readable board pinout text files |
| `memory/README.md` | Explains local memory files; real runtime memory should not be committed |
| `memory/.gitkeep` | Keeps the memory directory in Git |

## Scripts

| Script group | Examples |
|---|---|
| Setup | `setup.ps1`, `scripts/setup-conda-env.ps1` |
| Software smoke tests | `scripts/smoke-test.mjs`, `scripts/integration-smoke.mjs` |
| Knowledge and memory tests | `scripts/knowledge-smoke.mjs`, `scripts/memory-smoke.mjs` |
| Skill/MCP tests | `scripts/skill-smoke.mjs`, `scripts/mcp-smoke.mjs`, `scripts/verify-skill-contract.mjs` |
| Hardware checks | `scripts/hardware-preflight.mjs`, `scripts/hardware-readiness.mjs`, `scripts/usb-uart-diagnose.ps1`, `scripts/probe-serial-port.mjs` |

## Documentation

| Path | Purpose |
|---|---|
| `README.md` | Language selection entry |
| `README.zh-CN.md` | Main Chinese README with setup, architecture, competition, and reproducibility notes |
| `README.en.md` | Main English README |
| `.github/CONTRIBUTING.md` | Contribution guide |
| `.github/SECURITY.md` | Security and secret-handling policy |
| `.github/CODE_OF_CONDUCT.md` | Community conduct policy |
| `docs/PROJECT_STRUCTURE.md` | This file |
| `docs/REPRODUCIBILITY.md` | Reproducibility and verification guide |
| `docs/GITHUB_UPLOAD.md` | GitHub upload instructions |
| `docs/RELEASE_CHECKLIST.md` | Files to include/exclude and release checklist |
| `docs/RELEASE_FILE_LIST.txt` | Generated file list for the release snapshot |

## Files Intentionally Excluded

The following files and directories should not be committed:

```text
.env
node_modules/
dist/
runs/
.tmp*/
*.zip
*.log
generated firmware workspaces
local serial logs
large videos, slides, or rendered artifacts
```

They are excluded because they are either reproducible build outputs, local runtime state, private credentials, or large binary artifacts better suited for GitHub Releases or the competition submission system.
