# Release Checklist

This checklist keeps the GitHub repository clean, reproducible, and suitable for competition review.

## Include

### Source Code

```text
src/
server/
esp_agent/
scripts/
index.html
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
```

### Dependencies and Environment

```text
package.json
package-lock.json
requirements.txt
environment.yml
.env.example
setup.ps1
.editorconfig
.gitattributes
.gitignore
```

### Documentation and Community Files

```text
README.md
README.zh-CN.md
README.en.md
LICENSE
.github/
docs/
```

Competition-related setup, reproducibility, dependency, and submission notes are integrated into the README files. Large papers, videos, slides, and rendered artifacts should be submitted through the competition system or GitHub Releases instead of the main Git history.

## Exclude

```text
.env
node_modules/
dist/
runs/
.tmp*/
*.zip
*.log
gpt-image-2-output/
public/cam/
generated firmware workspaces
local serial logs
Office lock files such as ~$*.docx
```

## Pre-Release Verification

```powershell
git status --short
npm run build
npm run smoke:api
npm run integration:smoke
```

Optional hardware checks:

```powershell
npm run hardware:preflight
npm run hardware:readiness
npm run serial:probe -- --port COM12
```

Check for accidental secrets:

```powershell
rg -n "api[_-]?key|token|secret|sk-" . -g "!node_modules" -g "!.git"
```

## First GitHub Upload

```powershell
git init -b main
git add .
git commit -m "Initial release: Embex reproducible platform"
git remote add origin https://github.com/zmy596/embex-agent.git
git push -u origin main
```

If SSH is configured:

```powershell
git remote set-url origin git@github.com:zmy596/embex-agent.git
git push -u origin main
```

## Suggested Repository Description

```text
Memory-augmented ESP embedded-development agent with PlatformIO build, upload, serial observation, RAG, long memory, Skill/MCP, and ReAct closed-loop debugging.
```

## Suggested Topics

```text
esp32
esp8266
platformio
embedded-systems
agent
llm-agent
react-agent
rag
serial-monitor
iot
```
