# GitHub Upload Checklist

## 1. Files to Include

Include:

- source code: `src/`, `server/`, `esp_agent/`, `scripts/`
- dependency files: `package.json`, `package-lock.json`, `requirements.txt`, `environment.yml`
- project docs: `README.md`, `README.zh-CN.md`, `README.en.md`, `docs/`
- config examples: `.env.example`
- community files: `LICENSE`, `.github/CONTRIBUTING.md`, `.github/SECURITY.md`, `.github/CODE_OF_CONDUCT.md`
- root hygiene files: `.editorconfig`, `.gitattributes`, `.gitignore`

Competition setup, dependency, reproducibility, and submission notes are integrated into the README files. See `docs/PROJECT_STRUCTURE.md` and `docs/RELEASE_CHECKLIST.md` for repository organization and release rules.

## 2. Files to Exclude

Do not upload:

- `.env`
- API keys or private credentials
- `node_modules/`
- `dist/`
- `runs/`
- `.tmp-*`
- generated firmware temporary projects
- local serial logs with private device paths
- Office lock files such as `~$*.docx`

## 3. Pre-Upload Commands

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
```

## 4. Create GitHub Repository

Create an empty GitHub repository, then run:

```powershell
git branch -M main
git remote add origin https://github.com/zmy596/embex-agent.git
git push -u origin main
```

If `origin` already exists:

```powershell
git remote set-url origin https://github.com/zmy596/embex-agent.git
git push -u origin main
```

If SSH is configured:

```powershell
git remote set-url origin git@github.com:zmy596/embex-agent.git
git push -u origin main
```

## 5. Suggested Repository Description

```text
Memory-augmented ESP embedded-development agent with PlatformIO build, upload, serial observation, RAG, long memory, Skill/MCP, and ReAct closed-loop debugging.
```

## 6. Suggested Topics

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
