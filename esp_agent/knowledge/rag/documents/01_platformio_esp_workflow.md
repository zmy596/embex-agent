# PlatformIO ESP 工程、编译、烧录与串口监控

用途：帮助 Embex 为 ESP32、ESP32-S3、ESP32-C3、ESP8266 生成正确 PlatformIO 工程。

## 基本概念

- `platform`：芯片平台包。ESP32 / ESP32-S3 / ESP32-C3 通常使用 `espressif32`；ESP8266 使用 `espressif8266`。
- `board`：PlatformIO 板卡标识，决定芯片类型、工具链、flash 参数和默认构建配置。
- `framework`：开发框架。当前 Embex 首选 Arduino。

## 常见映射

| 用户板卡 | PlatformIO platform | PlatformIO board | framework |
|---|---|---|---|
| LuatOS ESP32C3 CORE | espressif32 | esp32-c3-devkitm-1 | arduino |
| ESP32-C3-DevKitM-1 | espressif32 | esp32-c3-devkitm-1 | arduino |
| ESP32-S3-DevKitC-1 / N16R8 / N8R8 | espressif32 | esp32-s3-devkitc-1 | arduino |
| ESP32 DevKit V1 | espressif32 | esp32dev | arduino |
| ESP8266 NodeMCU | espressif8266 | nodemcuv2 | arduino |

## 常用命令

编译：

```bash
python -m platformio run --project-dir <project_dir>
```

烧录：

```bash
python -m platformio run -t upload --upload-port COM12 --project-dir <project_dir>
```

串口监控：

```bash
python -m platformio device monitor --port COM12 --baud 115200
```

## 诊断规则

- 如果 board 选错，可能生成错误架构固件，例如 ESP32-C3 是 RISC-V，ESP32/S3 是 Xtensa。
- 如果串口被占用，烧录和监控会失败。
- 如果外设连接到 strapping / boot 相关引脚，烧录握手可能失败。
- 如果烧录成功但串口无日志，检查波特率、复位、`Serial.begin()`、程序是否重启循环。

参考资料：

- PlatformIO Espressif32: https://docs.platformio.org/en/latest/platforms/espressif32.html
- PlatformIO Espressif8266: https://docs.platformio.org/en/latest/platforms/espressif8266.html
- PlatformIO Boards: https://docs.platformio.org/en/latest/boards/index.html

