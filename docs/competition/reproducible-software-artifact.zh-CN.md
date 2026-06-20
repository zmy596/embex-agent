# Embex 可复现软件成果说明

## 1. 文档目的

本文档用于说明《Embex：面向 ESP 系列开发的记忆增强智能体闭环编译调试平台》的软件成果组成、运行环境、部署步骤、核心功能复现方法和验证命令，保证评审或复现实验人员能够在具备相同软硬件条件的情况下运行系统并验证核心结果。

本项目属于面向 ESP 系列嵌入式开发的智能体软件平台。系统以 Web 页面为交互入口，结合大模型、ReAct 决策、RAG 知识库、长期记忆、Skill/MCP 能力和 PlatformIO 工具链，完成从自然语言任务到固件生成、编译、烧录、串口监控、日志诊断和结果验收的闭环流程。

## 2. 软件成果清单

### 2.1 开源代码仓库内容

项目根目录包含以下核心软件成果：

| 目录或文件 | 内容说明 |
|---|---|
| `src/` | Web 前端页面，包含 Chat、Model、Hardware、Knowledge、Memory、Reports 等主要页面 |
| `server/` | 后端 API、智能体编排、模型调用、RAG、记忆、Skill/MCP 管理 |
| `server/langchainEspAgent.ts` | 基于 ReAct 思想的 ESP 开发智能体主流程 |
| `server/conversationAgent.ts` | 对话入口、任务分流、记忆读写、知识库检索和工具调用组织 |
| `server/index.ts` | Express API 服务入口 |
| `server/espPythonBridge.ts` | Node.js 到 Python ESP 工具层的桥接 |
| `esp_agent/tools/` | PlatformIO 工程生成、GPIO 校验、编译、烧录、串口监控、日志诊断等 Python 工具 |
| `esp_agent/knowledge/` | 板卡引脚资料、RAG 知识库文档、索引文件 |
| `esp_agent/skills/` | Skill 注册信息 |
| `server/mcp/` | 文件系统、Git、串口硬件、项目分析等 MCP 能力实现 |
| `server/memory/` | 长期记忆、短期上下文、硬件状态和项目事实持久化 |
| `scripts/` | 复现、测试、硬件预检、串口探测、Skill/MCP/RAG 验证脚本 |
| `package.json` | Node.js 依赖和复现命令入口 |
| `environment.yml` | Conda 环境说明，固定 Python、PlatformIO 和 pyserial 版本 |
| `.env.example` | 后端环境变量配置示例 |
| `vite.config.ts` | 前端开发服务器和 API 代理配置 |

### 2.2 当前 Git 基线

当前已提交基线版本：

```text
0d740a5 2026-06-19 06:22:05 +0800 前端基本修改
```

说明：当前工作区可能包含后续调试、素材生成或文档整理产生的未提交文件。正式提交材料前建议执行：

```powershell
git status --short
```

并确认需要提交或打包的文件范围。

## 3. 运行环境配置

### 3.1 推荐操作系统

推荐环境：

```text
Windows 10 / Windows 11
```

原因：

- 项目当前硬件联调主要基于 Windows 串口，例如 `COM12`；
- PlatformIO、pyserial、Node.js 和浏览器前端均可在 Windows 下直接运行；
- 烧录 ESP 开发板时需要 USB 串口驱动支持。

### 3.2 Node.js 与 npm

当前复现环境实测版本：

```text
Node.js v24.14.1
npm 11.11.0
```

项目 `environment.yml` 中也给出了可复现环境的 Node.js 依赖：

```yaml
nodejs=20
```

因此推荐使用 Node.js 20 及以上版本。若使用 Conda 环境，可按 `environment.yml` 创建统一环境。

### 3.3 Python、PlatformIO 与串口依赖

当前复现环境实测版本：

```text
Python 3.12.4
PlatformIO Core 6.1.19
```

`environment.yml` 固定的关键依赖如下：

```yaml
python=3.12
platformio==6.1.19
pyserial==3.5
```

PlatformIO 用于生成和编译 ESP 固件工程；pyserial 用于串口枚举、串口监控和日志采集。

## 4. 安装与部署步骤

### 4.1 获取代码

进入项目目录：

```powershell
cd D:\UserData\Documents\研电赛智能体
```

若从代码仓库重新获取，应确保完整包含以下内容：

- `src/`
- `server/`
- `esp_agent/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `environment.yml`
- `.env.example`

### 4.2 安装 Node.js 依赖

```powershell
npm install
```

如果使用 `package-lock.json` 做严格复现，也可使用：

```powershell
npm ci
```

### 4.3 创建或配置 Python/Conda 环境

项目提供 `environment.yml`，可创建名为 `yd-agent` 的 Conda 环境：

```powershell
conda env create -f environment.yml
```

如果环境已存在，可更新：

```powershell
conda env update -f environment.yml
```

也可以使用项目脚本：

```powershell
npm run setup:conda
```

### 4.4 配置 Python 路径

如需指定 ESP 工具层使用的 Python，可设置环境变量：

```powershell
$env:ESP_AGENT_PYTHON="D:\code\anaconda\envs\yd-agent\python.exe"
```

如果不设置，脚本会使用当前命令行可访问的 Python。

### 4.5 配置大模型接口

复制 `.env.example` 为 `.env`：

```powershell
Copy-Item .env.example .env
```

`.env.example` 中的关键字段如下：

```text
LLM_ENABLED=false
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
LLM_API_KEY=
```

说明：

- 不配置 API key 时，系统仍可运行基础页面、工具检测、知识库、部分本地兜底逻辑；
- 若要复现完整智能体规划、模型生成 `main.cpp` 和模型验收总结，需要在 Web 的 Model 页面或 `.env` 中配置 OpenAI-compatible 模型服务；
- 前端 Model 页面中的配置会随请求提交给后端，可覆盖 `.env` 中的默认模型配置。

## 5. 启动方式

### 5.1 开发模式启动

```powershell
npm run dev
```

该命令会同时启动：

| 服务 | 地址 | 说明 |
|---|---|---|
| Web 前端 | `http://127.0.0.1:5173/` | Vite 前端开发服务器 |
| 后端 API | `http://127.0.0.1:8787/` | Express API 服务 |

Vite 配置中已将 `/api` 代理到 `http://127.0.0.1:8787`。

### 5.2 生产构建

```powershell
npm run build
```

构建产物位于：

```text
dist/
```

### 5.3 预览构建结果

```powershell
npm run preview
```

## 6. 核心功能复现流程

### 6.1 Web 页面访问

启动后打开：

```text
http://127.0.0.1:5173/
```

左侧主要页面包括：

| 页面 | 复现内容 |
|---|---|
| Chat | 自然语言输入任务，查看智能体回复、流程状态和工具调用结果 |
| Model | 配置模型服务地址、模型名、API key、超时和 ReAct 轮次 |
| Hardware | 选择开发板、串口、常用外设、外设引脚和协议 |
| Knowledge | 查看 RAG 知识库、上传文档、测试检索、管理 Skill/MCP |
| Memory | 查看长期记忆、硬件状态、项目事实和近期对话 |
| Reports | 查看或导出调试报告、诊断结果和 REC 过程 |

### 6.2 硬件配置复现

以 LuatOS ESP32-C3 Core 为例：

1. 打开 Hardware 页面；
2. 选择板卡型号，例如 `luatos-esp32c3-core`；
3. 选择串口，例如 `COM12`；
4. 添加需要使用的外设；
5. 为外设配置实际连接的 GPIO；
6. 保存硬件配置；
7. 确认供电、GND 共地、启动脚和 USB 占用脚风险。

常见外设包括：

- 6pin SPI OLED；
- 4pin I2C OLED；
- LED；
- 蜂鸣器；
- AHT20；
- DHT11；
- BH1750；
- 通用 GPIO 外设。

### 6.3 智能体闭环任务复现

在 Chat 页面输入任务示例：

```text
让 OLED 显示你好，并通过串口输出 OLED 初始化状态
```

预期执行链路：

```text
接收任务
-> 模型规划
-> ReAct 决策
-> 模型生成 main.cpp
-> PlatformIO 工具执行
-> 编译
-> 烧录
-> 串口监控
-> 模型根据串口日志验收
-> 输出结果或重新思考
```

复现时需要确认：

- Model 页面已配置可用模型；
- Hardware 页面已配置正确串口；
- 开发板已连接电脑；
- PlatformIO 可正常编译目标板卡；
- 串口没有被其他程序占用。

### 6.4 编译但不烧录复现

如果未选择串口或不希望烧录，可在 Hardware 页面清空串口。此时系统仍可复现：

- 任务理解；
- `main.cpp` 生成；
- PlatformIO 工程生成；
- 编译；
- 编译错误诊断。

### 6.5 串口日志诊断复现

在 Chat 页面或诊断入口粘贴日志，例如：

```text
[BOOT] ESP closed-loop start
[ERROR] AHT20 not found at 0x38
```

系统应识别为日志诊断任务，并输出：

- 根因分析；
- 证据；
- 可能的硬件问题；
- 下一步检查建议。

## 7. 命令行验证方法

### 7.1 基础构建验证

```powershell
npm run build
```

用途：

- TypeScript 编译；
- Vite 前端构建；
- 检查前端和后端类型依赖是否存在明显错误。

### 7.2 API 快速 Smoke 测试

```powershell
npm run smoke:api
```

用途：

- 启动测试 API 服务；
- 检查健康接口；
- 检查 ESP 环境；
- 检查硬件预检；
- 检查日志诊断；
- 检查对话智能体基础链路。

### 7.3 集成 Smoke 测试

```powershell
npm run integration:smoke
```

用途：

- 验证 RAG 知识库；
- 验证 Skill/MCP 注册和调用；
- 验证对话记录写入记忆；
- 验证 ESP 引脚分析 Skill。

### 7.4 知识库验证

```powershell
npm run knowledge:smoke
```

用途：

- 重建或读取知识库索引；
- 检查内置 ESP/OLED/LuatOS 等知识是否可检索。

### 7.5 记忆模块验证

```powershell
npm run memory:smoke
```

用途：

- 验证长期记忆文件；
- 验证近期对话、硬件状态、项目事实写入。

### 7.6 Skill/MCP 验证

```powershell
npm run skill:smoke
npm run mcp:smoke
npm run capability:smoke
```

用途：

- 验证 Skill 注册；
- 验证 MCP 注册；
- 验证显式 `/skill_name` 或 `/mcp_name` 调用链路。

### 7.7 硬件预检

```powershell
npm run hardware:preflight
npm run hardware:readiness
npm run hardware:usb
```

用途：

- 检查 PlatformIO、pyserial 和 Python 工具；
- 检查串口设备；
- 生成硬件就绪报告。

### 7.8 串口探测

```powershell
npm run serial:probe -- --port COM12
```

用途：

- 检查串口是否可打开；
- 判断串口是否被占用；
- 为后续烧录和串口监控做准备。

### 7.9 完整验证脚本

```powershell
npm run verify
```

该脚本会串行执行 Python 编译检查、ESP 工具自测、Skill 合约检查、硬件预检、硬件就绪报告、USB-UART 诊断、类型检查、构建和 API smoke。由于包含硬件相关检测，执行耗时和结果会受本机串口、驱动和开发板连接状态影响。

## 8. 复现实验输入样例

### 8.1 OLED 显示任务

```text
让 6pin SPI OLED 显示 China，并在串口打印 OLED 初始化结果
```

需要硬件配置：

- OLED 协议：SPI；
- CLK/SCL；
- MOSI/SDA；
- RES/RST；
- DC；
- VCC；
- GND。

预期结果：

- PlatformIO 编译通过；
- 固件烧录到指定串口；
- 串口输出 OLED 初始化状态；
- OLED 屏幕显示指定内容；
- 智能体根据串口和任务目标给出验收结论。

### 8.2 LED 控制任务

```text
让 GPIO12 上的 LED 每 500ms 闪烁一次，并通过串口输出心跳日志
```

预期结果：

- 生成 LED 控制逻辑；
- 编译、烧录成功；
- 串口输出周期性日志；
- LED 物理闪烁。

### 8.3 传感器读取任务

```text
读取 AHT20 温湿度并输出到串口，如果读取失败请自动诊断
```

预期结果：

- 若硬件正常，串口输出温湿度；
- 若 I2C 地址无响应，系统给出接线、电源、GND、SDA/SCL、地址和总线冲突检查建议。

### 8.4 烧录失败诊断任务

```text
请诊断这段烧录日志：Invalid head of packet 0x45
```

预期结果：

- 识别为烧录握手异常；
- 提示检查 BOOT、串口占用、USB 数据线、启动脚占用、外设干扰等因素。

## 9. 可复现数据与结果保存位置

建议将复现实验产生的结果保存到以下位置：

| 目录 | 内容 |
|---|---|
| `runs/` | 硬件运行、就绪检查、临时工程和日志 |
| `runs/hardware-readiness/` | 硬件就绪报告 JSON 和 Markdown |
| `dist/` | 前端构建结果 |
| `memory/` | 长期记忆、短期上下文、硬件状态、项目事实 |
| `esp_agent/knowledge/rag/` | RAG 知识库文档、索引和切片 |
| `比赛提交材料/` | 参赛论文、说明文档、演示素材和测试汇总 |

建议后续补充：

```text
比赛提交材料/测试结果汇总.md
比赛提交材料/演示脚本.md
比赛提交材料/系统设计说明.md
```

## 10. 复现注意事项

1. **模型配置差异会影响回复质量**  
   不同浏览器的 Model 页面配置可能不同，因为前端配置会保存在浏览器本地存储中。复现实验前应统一模型 base URL、模型名和 API key。

2. **硬件串口会影响烧录结果**  
   如果串口被占用、驱动异常、外设接到启动相关 GPIO，可能导致烧录失败。应先运行 `serial:probe` 和 `hardware:preflight`。

3. **编译和烧录耗时较长**  
   PlatformIO 首次编译会下载或构建依赖，耗时可能明显长于普通 API smoke。建议将 `smoke:api` 和 `smoke:compile` 分开执行。

4. **ESP 板卡型号必须与 PlatformIO board 对应**  
   例如 LuatOS ESP32-C3 Core 可映射到 ESP32-C3 相关 PlatformIO board。若板卡选择错误，可能导致二进制架构不匹配或烧录失败。

5. **外设配置以当前硬件页面保存内容为准**  
   未启用的外设不应默认参与固件生成；未配置引脚一般以 `-1` 表示禁用。

6. **`main.cpp` 由模型主导生成**  
   `agent_peripherals` 是可选辅助函数库，不替代模型对主程序逻辑的控制。复现时应检查工具返回中的 `main_cpp`、代码摘要、编译日志和串口日志。

## 11. 评审复现建议流程

建议评审或复现实验人员按以下顺序执行：

```text
1. npm install 或 npm ci
2. 配置 Python / PlatformIO / pyserial
3. 配置 .env 或 Web Model 页面
4. npm run build
5. npm run smoke:api
6. npm run integration:smoke
7. npm run dev
8. 浏览器打开 http://127.0.0.1:5173/
9. 在 Hardware 页面选择板卡、串口和外设
10. 在 Chat 页面输入硬件任务
11. 查看流程状态、工具调用、串口日志、验收结论和报告
```

如果没有硬件，也可以完成软件侧复现：

```text
1. 启动 Web 和 API
2. 配置模型
3. 输入不烧录的固件生成任务
4. 查看 main.cpp 生成、PlatformIO 编译和诊断输出
5. 使用日志诊断样例验证诊断链路
```

## 12. 结论

Embex 的软件成果可通过代码仓库、环境配置文件、npm 脚本、Python/PlatformIO 工具层、RAG 知识库、长期记忆文件和 Web 页面进行复现。其核心复现目标不是展示固定 demo，而是验证智能体能在当前硬件配置下完成“任务理解、代码生成、工具执行、串口观测、结果验收和失败修正”的嵌入式开发闭环。

