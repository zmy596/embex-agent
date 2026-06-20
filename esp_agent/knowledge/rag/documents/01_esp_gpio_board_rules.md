# ESP GPIO 与板卡选脚规则

用途：帮助 Embex 在生成代码和回答接线问题前识别 GPIO 风险。

## 通用规则

- ESP 芯片多数外设可通过 GPIO matrix 重映射，但不是所有 GPIO 都适合外接模块。
- 启动脚、USB 引脚、Flash/PSRAM 引脚、输入专用脚需要谨慎。
- 用户实际板卡优先于芯片裸片资料；开发板可能占用额外 GPIO。
- 同一个 GPIO 被多个外设占用时，必须提示冲突并要求用户选择。
- 当烧录失败时，不能直接断定某个普通 GPIO 本身有问题；必须结合接线、电平、外设上拉/下拉、BOOT/EN 状态和 esptool 日志判断。

## ESP32

- GPIO6-GPIO11 通常连接 SPI Flash，不建议作为普通外设 GPIO。
- GPIO34-GPIO39 为输入专用，不能输出驱动 LED、蜂鸣器等。
- GPIO0、GPIO2、GPIO12、GPIO15 与启动配置相关，接外设需谨慎。

## ESP32-C3

- GPIO8、GPIO9 常与启动/BOOT 相关，谨慎使用。
- GPIO18/GPIO19 在部分设计中可作为 USB D-/D+，连接外设可能影响 USB。
- LuatOS ESP32C3 CORE 上的 GPIO11 不应被默认判定为烧录失败根因；本项目曾出现“DHT11 接线错误导致烧录异常”的历史案例，根因是误接线，不是 GPIO11 或 DHT11 本身缺陷。
- 如果 GPIO11 上连接外设后出现烧录异常，应优先检查实际接线、供电、DATA 上拉/下拉和是否误接到相邻引脚，而不是直接禁止使用 GPIO11。

## ESP32-S3

- GPIO19/GPIO20 常用于 USB D-/D+。
- GPIO0、GPIO3、GPIO45、GPIO46 与 strapping/启动配置相关，谨慎使用。
- N16R8 / N8R8 是 Flash/PSRAM 配置，不是独立板卡型号；选脚应参考具体开发板。

## ESP8266

- GPIO0、GPIO2、GPIO15 是启动关键脚，外设电平可能导致无法启动或无法烧录。
- GPIO6-GPIO11 通常用于 Flash，不建议使用。
- NodeMCU 的 D0-D8 与 GPIO 编号不同，模型必须区分丝印编号和 GPIO 编号。

参考资料：

- Espressif Hardware Design Guidelines: https://docs.espressif.com/projects/esp-hardware-design-guidelines/
- ESP-IDF GPIO API: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html
- Arduino ESP8266 Boards: https://arduino-esp8266.readthedocs.io/en/latest/boards.html

