# Embex：面向 ESP 系列开发的记忆增强智能体闭环编译调试平台

Embex 是一个面向 ESP 系列嵌入式开发的记忆增强智能体平台。它将自然语言硬件任务转化为完整闭环流程：任务理解、ReAct 规划、模型主导 `main.cpp` 生成、PlatformIO 编译、烧录、串口观测、日志诊断、结果验收和必要的修正重试。

Embex 不是固定 demo 生成器。模型拥有固件主逻辑控制权，`agent_peripherals` 等函数库只是可选辅助能力。

## 核心能力

- Web 对话页面输入自然语言硬件任务；
- 模型主导生成 ESP Arduino `main.cpp`；
- 自动生成 PlatformIO 工程；
- 自动编译、烧录、串口监控；
- 根据编译错误、烧录错误、串口日志和硬件现象进行诊断；
- 支持硬件配置、开发板型号、串口、外设、引脚和通信协议管理；
- 内置 RAG 知识库，沉淀 ESP 板卡、GPIO、外设和调试经验；
- 支持长期记忆和上下文压缩，保存硬件状态、用户偏好、项目事实和失败案例；
- 支持 Skill / MCP 能力扩展，用于引脚分析、项目分析、文件系统、Git 和串口硬件工具。

## 支持范围

目标芯片和开发板：

- ESP32
- ESP32-S3
- ESP32-C3
- ESP8266
- LuatOS ESP32-C3 Core 等兼容开发板

常见外设：

- OLED，包括 I2C OLED 和 6pin SPI OLED
- LED
- 无源蜂鸣器
- AHT20
- DHT11
- BH1750
- 通用 GPIO 外设

## 项目结构

| 路径 | 说明 |
|---|---|
| `src/` | React Web 前端 |
| `server/` | Express API、智能体编排、RAG、记忆、Skill/MCP |
| `server/langchainEspAgent.ts` | ReAct 风格 ESP 智能体 |
| `server/conversationAgent.ts` | 对话入口、任务路由、记忆和知识库整合 |
| `esp_agent/tools/` | Python 工具层，负责 PlatformIO、串口、GPIO 校验和诊断 |
| `esp_agent/knowledge/` | 板卡引脚资料和本地 RAG 知识库 |
| `memory/` | 本地记忆目录说明 |
| `scripts/` | smoke 测试、硬件预检、串口探测和验证脚本 |
| `docs/` | GitHub 复现、上传和竞赛说明 |

## 快速开始

### 1. 克隆项目

```powershell
git clone https://github.com/<your-name>/embex.git
cd embex
```

### 2. 一键配置环境

Windows 推荐：

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

手动安装：

```powershell
npm install
python -m pip install -r requirements.txt
```

如果希望严格按照 `package-lock.json` 复现：

```powershell
npm ci
```

### 3. 配置模型

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```text
LLM_ENABLED=true
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=<your-model>
LLM_API_KEY=<your-api-key>
```

也可以在 Web 页面中的 Model 页面配置模型。不要把 `.env` 上传到 GitHub。

### 4. 启动系统

```powershell
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

默认服务：

| 服务 | 地址 |
|---|---|
| Web 前端 | `http://127.0.0.1:5173/` |
| 后端 API | `http://127.0.0.1:8787/` |

## 依赖环境

Python 依赖：

```text
platformio==6.1.19
pyserial==3.5
```

Conda 环境：

```powershell
conda env create -f environment.yml
```

可选 Python 路径覆盖：

```powershell
$env:ESP_AGENT_PYTHON="D:\code\anaconda\envs\yd-agent\python.exe"
```

## 验证命令

构建验证：

```powershell
npm run build
```

API smoke：

```powershell
npm run smoke:api
```

RAG / 记忆 / Skill / MCP 集成验证：

```powershell
npm run integration:smoke
```

硬件预检：

```powershell
npm run hardware:preflight
npm run hardware:readiness
npm run hardware:usb
```

串口探测：

```powershell
npm run serial:probe -- --port COM12
```

完整验证：

```powershell
npm run verify
```

说明：硬件验证结果取决于开发板、USB-UART 驱动、串口占用和实际接线。

## 示例任务

OLED：

```text
让 6pin SPI OLED 显示 China，并在串口打印 OLED 初始化结果。
```

LED：

```text
让 GPIO12 上的 LED 每 500ms 闪烁一次，并通过串口输出心跳日志。
```

传感器：

```text
读取 AHT20 温湿度并输出到串口，如果读取失败请自动诊断。
```

日志诊断：

```text
请诊断这段烧录日志：Invalid head of packet 0x45
```

## 竞赛复现材料

- `docs/competition/reproducible-software-artifact.zh-CN.md`
- `docs/competition/dependencies.zh-CN.md`
- `docs/REPRODUCIBILITY.md`
- `docs/GITHUB_UPLOAD.md`
- `docs/COMPETITION_SUBMISSION.md`

## 为什么完整闭环需要本地运行

Embex 可以部署公网 Web 演示版，但完整 ESP 编译、烧录和串口监控需要访问用户本机 COM 口和开发板。因此完整硬件闭环建议通过 GitHub 克隆后在本地运行。

推荐公开方式：

```text
GitHub 仓库：源码、文档、复现脚本
本地运行：完整 PlatformIO 编译/烧录/串口闭环
公网演示：Web UI、RAG、记忆、日志诊断、软件侧流程
```

## 安全说明

- 不要提交 `.env` 或 API key；
- 不要提交 `node_modules/`、`dist/`、`runs/`、临时固件工程或本地日志；
- 发布串口日志前应检查是否包含本地路径、设备 ID 或隐私信息；
- 烧录硬件前应确认板卡型号、串口、供电、GND、启动脚和外设接线。

## License

MIT License. See [LICENSE](LICENSE).

