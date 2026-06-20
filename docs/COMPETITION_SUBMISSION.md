# Competition Submission Notes

Embex is prepared as a software-algorithm project with hardware-system demonstration support.

## 1. Software Algorithm Category

The repository provides reproducible software artifacts:

- complete source code,
- dependency files,
- command-line setup script,
- model configuration example,
- build and smoke-test scripts,
- RAG knowledge documents,
- memory storage design,
- Skill/MCP capability registry,
- PlatformIO tool integration,
- reproducibility documentation.

Key reproducibility files:

```text
README.md
requirements.txt
environment.yml
setup.ps1
docs/REPRODUCIBILITY.md
比赛提交材料/可复现软件成果说明.md
比赛提交材料/依赖库文件.md
```

Recommended verification:

```powershell
npm run build
npm run smoke:api
npm run integration:smoke
```

## 2. Hardware System Demonstration Support

Embex can be demonstrated with physical ESP hardware:

- board model selection,
- serial port selection,
- peripheral and pin configuration,
- PlatformIO firmware build,
- upload to ESP board,
- serial monitor capture,
- log diagnosis,
- task-specific acceptance.

Recommended hardware evidence:

- board and wiring photo,
- Web hardware configuration screenshot,
- generated firmware summary,
- compile and upload logs,
- serial output,
- video of the running board,
- final agent diagnosis and acceptance result.

## 3. Suggested Demo Flow

```text
1. Show project architecture.
2. Show Web pages: Chat, Model, Hardware, Knowledge, Memory, Reports.
3. Configure ESP board and serial port.
4. Input a natural-language task.
5. Show ReAct planning and tool timeline.
6. Show generated main.cpp / compile / upload.
7. Show serial logs and physical hardware effect.
8. Show final acceptance and report.
9. Show RAG, memory, Skill/MCP evidence.
```

## 4. Public Deployment Positioning

Full ESP flashing requires local hardware access. A public Web deployment can demonstrate:

- Web UI,
- model configuration,
- RAG retrieval,
- memory,
- Skill/MCP pages,
- log diagnosis,
- software-only firmware generation.

The full compile/upload/serial loop should be reproduced locally by cloning the GitHub repository.

