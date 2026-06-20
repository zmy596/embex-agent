# Embex main.cpp 生成规则

用途：约束 Embex 在 ESP 系列开发任务中生成 Arduino 固件源码，避免模型只给片段代码、误用模板或假设不存在的外设。

## 核心原则

- 模型主导生成完整 `src/main.cpp`，工具链只负责创建 PlatformIO 工程、编译、烧录和串口监控。
- `agent_peripherals.h/cpp` 是可选辅助函数库；模型可以调用其中函数，也可以直接使用 Arduino / U8g2 / DHT / Wire / SPI 等库。
- 任何外设只有在硬件配置页 `peripherals` 中启用且配置了引脚，才视为真实可用外设。
- 不得因为历史对话中出现过蜂鸣器、AHT20、DHT11、OLED、LED 就默认本轮可用；必须读取当前硬件配置。

## main.cpp 最低结构

每次需要编译烧录的固件必须精确包含：

```cpp
#include <Arduino.h>

void setup() {
}

void loop() {
}
```

允许增加其他 include、全局对象、辅助函数和类，但不能缺少 `Arduino.h`、`setup()`、`loop()`。

## 串口日志规则

固件必须在 `setup()` 中初始化串口：

```cpp
Serial.begin(115200);
delay(300);
Serial.println("[BOOT] Embex firmware start");
```

建议输出：

- `[BOOT]`：固件启动。
- `[PIN]`：板卡型号、外设引脚、协议。
- `[APP]`：任务逻辑状态。
- `[OLED]`、`[LED]`、`[DHT11]`、`[AHT20]`、`[BUZZER]`：外设状态。
- `[ERROR]`：初始化或读取失败。
- `[HEARTBEAT]`：loop 正常运行。

## 验收规则

编译成功不等于任务成功；烧录成功也不等于功能成功。任务完成必须结合任务类型判断：

- OLED：串口应显示 OLED 初始化和显示更新日志，用户或摄像头观察应确认屏幕内容。
- LED：串口应记录目标 GPIO 和状态变化；用户观察应确认亮灭行为。
- 传感器：串口应包含读数或明确错误码。
- 蜂鸣器：串口应包含蜂鸣器事件；用户观察应确认发声。
- 诊断任务：必须输出失败节点、证据、原因假设和下一步动作。

## 禁止行为

- 不得无条件使用固定 demo 模板覆盖模型生成的 `main.cpp`。
- 不得把未配置外设写进固件。
- 不得在初始化中长时间阻塞导致 watchdog reset。
- 不得在 ESP32-C3 / ESP32-S3 上随意使用 USB、strapping、flash 相关高风险引脚。

