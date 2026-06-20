# LuatOS ESP32C3 CORE 开发注意事项

用途：记录当前项目重点使用的合宙 LuatOS ESP32C3 核心板经验。

## PlatformIO 配置

推荐映射：

```ini
[env:luatos_esp32c3_core]
platform = espressif32
board = esp32-c3-devkitm-1
framework = arduino
monitor_speed = 115200
```

## 选脚经验

- GPIO4 / GPIO5 可用于常见 I2C 或软件 SPI 信号，但要避免同一任务中重复分配。
- GPIO6、GPIO10、GPIO11、GPIO12、GPIO13 等可作为普通外设 GPIO，具体仍以当前板卡引脚表和实际接线为准。
- GPIO8、GPIO9 与启动相关，默认谨慎。
- GPIO18/GPIO19 与 USB 相关风险，需要结合实际板卡连接判断。
- GPIO11 不应被默认视为烧录失败根因；本项目此前相关问题已确认是接线错误，不是 GPIO11 本身缺陷。

## 当前项目硬件经验

SPI OLED 6pin 曾使用：

- CLK -> GPIO5
- MOSI -> GPIO4
- DC -> GPIO6
- RES -> GPIO18

LED 曾使用：

- GPIO12

DHT11 历史误接线案例：

- 曾观察到 DHT11 接入后烧录异常。
- 后续确认是当时接线错误导致，不是 GPIO11 或 DHT11 本身问题。
- 如果再次出现类似烧录异常，应检查接线顺序、实际 GPIO 编号、DATA 上拉/下拉、供电和 BOOT/EN 状态。

## 诊断策略

如果烧录失败：

1. 先断开最近新增的外设，仅保留 USB。
2. 确认 COM 口。
3. 手动按 BOOT/复位尝试。
4. 逐个恢复外设。
5. 对连接到 GPIO8、GPIO9、GPIO18、GPIO19 或任何接线不确定的外设优先排查。
6. 不得在缺少日志证据时把 GPIO11 直接判定为故障原因。

