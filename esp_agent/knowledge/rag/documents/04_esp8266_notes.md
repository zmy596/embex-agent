# ESP8266 开发注意事项

用途：帮助 Embex 支持 ESP8266 系列开发板，尤其是 NodeMCU / ESP-12E。

## PlatformIO 配置

NodeMCU 常用：

```ini
[env:nodemcuv2]
platform = espressif8266
board = nodemcuv2
framework = arduino
monitor_speed = 115200
```

## 引脚编号

ESP8266 NodeMCU 丝印 D0-D8 与 GPIO 编号不同：

- D1 通常对应 GPIO5。
- D2 通常对应 GPIO4。
- D3 通常对应 GPIO0。
- D4 通常对应 GPIO2。
- D8 通常对应 GPIO15。

模型回答和生成代码时必须使用 Arduino 实际可识别的引脚常量或明确 GPIO 编号，不能混淆丝印。

## 启动脚风险

- GPIO0、GPIO2、GPIO15 会影响启动模式。
- GPIO6-GPIO11 通常连接 flash，不应作为普通外设。
- 外设上拉/下拉可能导致无法启动或无法烧录。

## 外设建议

- I2C OLED / AHT20 常用 D1/D2，即 GPIO5/GPIO4。
- DHT11 可选普通安全 GPIO，避开启动脚。
- LED 可选 D5/D6/D7 等，仍需确认板卡实际连接。

参考资料：

- Arduino ESP8266 Boards: https://arduino-esp8266.readthedocs.io/en/latest/boards.html
- PlatformIO Espressif8266: https://docs.platformio.org/en/latest/platforms/espressif8266.html

