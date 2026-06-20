# Embex Local RAG Knowledge Base

本目录保存 Embex 本地 RAG 知识库，用于辅助 ESP 系列嵌入式开发智能体进行任务理解、代码生成、编译烧录、串口诊断和项目验收。

## 当前存储方式

当前 RAG 引擎扫描 `documents/` 目录，支持递归读取子目录。为了让 Web 页面列表更直观，内置知识文档仍优先采用文件名前缀分类：

- `00_`：Embex 自身规则、ReAct 工作流、main.cpp 生成规则。
- `01_`：ESP 板卡、GPIO、PlatformIO 工程规则。
- `02_`：OLED、DHT11、AHT20、LED、蜂鸣器等外设规则。
- `03_`：烧录失败、串口失败、watchdog、brownout、GPIO 冲突诊断。
- `04_`：具体板卡系列经验。
- `05_`：可组合的小项目案例。

## 索引文件

- `knowledge_manifest.json`：知识文件清单。
- `chunks.jsonl`：文本分块索引。
- `index.json`：索引状态摘要。
- `documents/`：原始知识文档。

## 检索能力

当前检索模式为 `hybrid-keyword-local`，不依赖云向量服务，包含：

- 递归扫描知识文档。
- reindex 使用稳定文档 ID，避免每次重建产生重复记录。
- 自动从 Markdown 一级标题提取 title。
- 根据文件名和正文自动推断 tags。
- 按 Markdown 标题分块，长段落再滑窗切分。
- 同时使用英文 token、中文词组、中文 bigram 和少量领域同义词。
- 标题、文件名、tags 命中比正文命中权重更高。
- 返回命中 terms、score 和引用片段，便于对话页追踪。

该实现是本地轻量混合检索，适合比赛原型和离线演示；后续可继续升级为“关键词 + 本地 embedding 向量库”的混合检索。

## 维护规则

- 不要把 smoke 测试文档长期留在正式知识库中。
- 不要提交乱码内容；所有知识文档使用 UTF-8。
- 每次新增、删除或修改 `documents/` 后，需要调用 `POST /api/knowledge/reindex` 或直接运行后端 reindex。
- 知识条目应写成可执行工程规则，而不是泛泛资料摘抄。
- 涉及外部资料时，在文档中保留来源链接。

## 重点资料来源

- Espressif Hardware Design Guidelines: https://docs.espressif.com/projects/esp-hardware-design-guidelines/
- ESP-IDF Programming Guide: https://docs.espressif.com/projects/esp-idf/
- PlatformIO Espressif32: https://docs.platformio.org/en/latest/platforms/espressif32.html
- PlatformIO Espressif8266: https://docs.platformio.org/en/latest/platforms/espressif8266.html
- Arduino ESP8266: https://arduino-esp8266.readthedocs.io/
