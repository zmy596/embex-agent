# GitHub 项目文件清单

本清单用于整理 Embex 上传 GitHub 时建议包含和排除的文件，兼顾比赛可复现要求与 GitHub 社区项目风格。

## 建议上传的核心文件

### 代码

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

### 依赖与环境

```text
package.json
package-lock.json
requirements.txt
environment.yml
.env.example
setup.ps1
```

### GitHub 社区文件

```text
README.md
LICENSE
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
.github/
docs/
GITHUB_PROJECT_FILES.md
```

### 竞赛复现说明

竞赛相关说明已集中写入 `README.zh-CN.md` 和 `README.en.md`，不再单独设立竞赛文档。论文、PPT、视频、PDF 等大文件建议放到 GitHub Release 或比赛提交系统，不建议直接塞进主仓库历史。

## 不建议上传的文件

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
```

原因：

- `.env` 可能包含 API key；
- `node_modules/` 可由 `npm install` 复现；
- `dist/` 可由 `npm run build` 生成；
- `runs/` 和 `.tmp*/` 是本地运行产物；
- `gpt-image-2-output/` 是图片生成临时素材；
- `public/cam/` 可能包含本地拍摄素材；
- zip、日志和大二进制文件会增加仓库体积。

## 上传前推荐命令

```powershell
git status --short
npm run build
npm run smoke:api
npm run integration:smoke
```

确认没有密钥：

```powershell
rg -n "api[_-]?key|token|secret|sk-" . -g "!node_modules" -g "!.git"
```

## 首次上传 GitHub

```powershell
git add README.md README.zh-CN.md README.en.md LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md GITHUB_PROJECT_FILES.md docs .github requirements.txt setup.ps1 .gitignore package.json package-lock.json environment.yml .env.example src server esp_agent scripts index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json
git commit -m "docs: prepare GitHub reproducible release"
git branch -M main
git remote add origin https://github.com/<your-name>/embex.git
git push -u origin main
```

如果已经有远程仓库：

```powershell
git remote set-url origin https://github.com/<your-name>/embex.git
git push -u origin main
```
