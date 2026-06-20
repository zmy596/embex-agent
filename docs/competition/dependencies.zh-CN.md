# Embex 依赖库文件

## 1. 基础运行环境

| 类型 | 推荐版本 | 用途 |
|---|---:|---|
| Windows | Windows 10 / Windows 11 | 串口、USB 驱动、PlatformIO 烧录环境 |
| Node.js | 20.x 及以上 | 前端、后端、脚本运行环境 |
| npm | 10.x 及以上 | Node.js 依赖安装与脚本执行 |
| Python | 3.12.x | ESP 工具层、PlatformIO、串口工具 |
| PlatformIO Core | 6.1.19 | ESP 固件工程生成、编译、烧录 |
| pyserial | 3.5 | 串口枚举、串口监控、串口探测 |

当前本机实测环境：

```text
Node.js v24.14.1
npm 11.11.0
Python 3.12.4
PlatformIO Core 6.1.19
```

## 2. Node.js 依赖库

Node.js 依赖以项目根目录 `package.json` 和 `package-lock.json` 为准。

### 2.1 运行依赖

| 依赖库 | 当前版本 | 用途 |
|---|---:|---|
| `react` | `^19.1.1` | Web 前端 UI 框架 |
| `react-dom` | `^19.1.1` | React DOM 渲染 |
| `vite` | `^7.1.5` | 前端开发服务器与构建工具 |
| `typescript` | `^5.9.3` | TypeScript 编译与类型检查 |
| `tsx` | `^4.20.5` | 直接运行 TypeScript 后端和脚本 |
| `express` | `^5.1.0` | 后端 HTTP API 服务 |
| `cors` | `^2.8.5` | 后端跨域支持 |
| `zod` | `^4.4.3` | API 参数和工具调用 schema 校验 |
| `langchain` | `^1.4.5` | 智能体与 ReAct 流程组织 |
| `@langchain/openai` | `^1.4.7` | OpenAI-compatible 模型调用 |
| `lucide-react` | `^0.468.0` | Web 前端图标 |
| `concurrently` | `^9.2.1` | 同时启动前端和后端开发服务 |
| `@vitejs/plugin-react` | `^5.0.0` | Vite React 插件 |

### 2.2 类型依赖

| 依赖库 | 当前版本 | 用途 |
|---|---:|---|
| `@types/node` | `^24.3.0` | Node.js 类型定义 |
| `@types/react` | `^19.1.12` | React 类型定义 |
| `@types/react-dom` | `^19.1.9` | React DOM 类型定义 |
| `@types/express` | `^5.0.3` | Express 类型定义 |
| `@types/cors` | `^2.8.19` | CORS 类型定义 |

## 3. Python 依赖库

Python 依赖以项目根目录 `environment.yml` 为准。

```yaml
name: yd-agent
channels:
  - conda-forge
  - defaults
dependencies:
  - python=3.12
  - nodejs=20
  - pip
  - pip:
      - platformio==6.1.19
      - pyserial==3.5
```

### 3.1 Python 依赖用途

| 依赖库 | 版本 | 用途 |
|---|---:|---|
| `platformio` | `6.1.19` | 生成 PlatformIO 工程、编译、烧录 ESP 固件 |
| `pyserial` | `3.5` | 串口列表、串口监控、串口探测 |

## 4. 外部工具依赖

| 工具 | 用途 | 说明 |
|---|---|---|
| PlatformIO | ESP 固件构建和烧录 | 由 Python 依赖 `platformio` 提供 |
| USB-UART 驱动 | 识别开发板串口 | 例如 CH340、CH343、CH347、CP210x 等 |
| 浏览器 | 访问 Web 页面 | 推荐 Chrome / Edge |
| Git | 版本管理与 GitHub 上传 | 用于代码提交、分支和远程仓库 |

## 5. ESP / Arduino 库依赖

固件工程由 Embex 在运行过程中动态生成 PlatformIO 工程。具体固件依赖会根据任务和外设自动写入临时工程配置。

常见外设可能使用的库包括：

| 外设或功能 | 可能使用的库 | 用途 |
|---|---|---|
| Arduino 基础框架 | `framework = arduino` | ESP Arduino 开发框架 |
| OLED 中文显示 | `U8g2` | SSD1306 / SH1106 OLED 驱动与中文字体显示 |
| AHT20 | AHT20 相关 Arduino 库或 Wire 直接驱动 | 温湿度读取 |
| DHT11 | DHT 相关 Arduino 库或时序读取代码 | 温湿度读取 |
| I2C | `Wire` | I2C 总线通信 |
| GPIO / PWM | Arduino 内置 API | LED、蜂鸣器、通用 GPIO 控制 |

说明：不同任务可能生成不同 `platformio.ini` 和 `src/main.cpp`。最终以每轮工具生成的 PlatformIO 工程为准。

## 6. 安装命令

### 6.1 安装 Node.js 依赖

```powershell
npm install
```

或严格按 `package-lock.json` 复现：

```powershell
npm ci
```

### 6.2 创建 Conda 环境

```powershell
conda env create -f environment.yml
```

或更新已有环境：

```powershell
conda env update -f environment.yml
```

### 6.3 指定 ESP 工具层 Python

```powershell
$env:ESP_AGENT_PYTHON="D:\code\anaconda\envs\yd-agent\python.exe"
```

## 7. 验证命令

### 7.1 验证 Node.js 与 npm

```powershell
node --version
npm --version
```

### 7.2 验证 Python 与 PlatformIO

```powershell
python --version
python -m platformio --version
```

### 7.3 验证 pyserial

```powershell
python -c "import serial; print(serial.VERSION)"
```

### 7.4 验证项目构建

```powershell
npm run build
```

### 7.5 验证 API 与核心链路

```powershell
npm run smoke:api
npm run integration:smoke
```

## 8. 启动命令

```powershell
npm run dev
```

默认访问地址：

```text
Web: http://127.0.0.1:5173/
API: http://127.0.0.1:8787/
```

## 9. 备注

1. `node_modules/` 不应提交到 GitHub，复现时通过 `npm install` 或 `npm ci` 重新安装。
2. `.env` 不应提交到 GitHub，避免泄露模型 API key；只提交 `.env.example`。
3. `package-lock.json` 和 `environment.yml` 应提交，用于固定依赖版本。
4. 如果需要完整硬件闭环，复现机器必须安装 USB-UART 驱动，并连接 ESP 开发板。
5. 如果只复现软件侧功能，可不连接硬件，仍可验证 Web 页面、模型配置、RAG、记忆、Skill/MCP、日志诊断和编译链路。

