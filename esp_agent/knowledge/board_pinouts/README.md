# ESP Board Pinout Knowledge

本目录保存 ESP 系列开发板引脚功能资料，供 Web 硬件页和智能体读取。

- 结构化数据：`boards.json`
- 页面可读取 API：`GET /api/boards/pinouts`
- 模型上下文：前端会把当前 `boardPinMap` 放入 `hardwareStatus.boardPinMap` 发给后端；后端提示词要求模型先读取该结构再决定 GPIO。

资料来源：

- ESP32-S3-DevKitC-1: https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.0.html
- ESP32-C3-DevKitM-1: https://docs.espressif.com/projects/esp-idf/en/v5.2/esp32c3/hw-reference/esp32c3/user-guide-devkitm-1.html
- ESP32-C3-DevKitC-02: https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32c3/hw-reference/esp32c3/user-guide-devkitc-02.html
- LuatOS ESP32C3 CORE: https://wiki.luatos.org/chips/esp32c3/board.html
- ESP32 DevKitC / DevKit V1: https://docs.espressif.com/projects/esp-idf/en/v5.1/esp32/hw-reference/esp32/get-started-devkitc.html
- ESP8266 NodeMCU: https://arduino-esp8266.readthedocs.io/en/latest/boards.html#nodemcu-1-0-esp-12e-module

注意：ESP 芯片多数 GPIO 支持 GPIO matrix，具体外设可重映射；本文件用于工程选脚时规避启动脚、输入专用脚、USB/Flash 占用脚，并提供常用默认功能提示。
