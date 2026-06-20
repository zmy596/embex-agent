# OLED I2C/SPI、SSD1306/SH1106 开发规则

用途：指导 Embex 正确识别 OLED 协议、选择驱动库和生成显示代码。

## 接口识别

I2C OLED 常见引脚：

- VCC
- GND
- SDA
- SCL

SPI 6pin OLED 常见引脚：

- VCC
- GND
- SCL / CLK
- SDA / MOSI / DIN
- RES / RST
- DC

注意：SPI OLED 上的 `SCL` 通常是时钟 `CLK`，`SDA` 通常是数据 `MOSI`，不是 I2C 的 SCL/SDA。

## 驱动选择

- SSD1306 与 SH1106 不是完全相同的控制器。
- 如果 SSD1306 代码编译烧录成功但屏幕不亮，应尝试 SH1106 构造器。
- U8g2 支持软件 SPI，适合任意 GPIO 映射。

常见 U8g2 构造器示例：

```cpp
U8G2_SSD1306_128X64_NONAME_F_4W_SW_SPI u8g2(U8G2_R0, clk, mosi, cs, dc, reset);
U8G2_SH1106_128X64_NONAME_F_4W_SW_SPI u8g2(U8G2_R0, clk, mosi, cs, dc, reset);
```

没有 CS 的 6pin 模块通常使用 `U8X8_PIN_NONE`。

## 中文显示

- Arduino `Serial.println("中文")` 与 OLED 中文显示是两件事。
- OLED 真正显示中文需要字库支持，例如 U8g2 中文字体。
- 字库会明显增加 flash 占用。
- 若屏幕显示乱码，需要检查源码编码、字体、控制器型号、显示函数和字符串内容。

## 验收标准

- 串口日志包含 OLED 协议、控制器、引脚、初始化状态。
- 屏幕应显示用户指定内容。
- 若屏幕不亮，不能只报告“烧录成功”；需要诊断协议、控制器、电源、RES/DC/CLK/MOSI 接线。

