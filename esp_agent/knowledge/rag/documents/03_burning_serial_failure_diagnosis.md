# ESP 烧录失败与串口诊断规则

用途：帮助 Embex 根据 PlatformIO / esptool / 串口日志定位失败节点。

## 烧录失败常见原因

- 串口号错误。
- 串口被其他程序占用。
- USB 线只有供电没有数据。
- 板卡未进入下载模式，需要按 BOOT。
- 外设占用启动脚，导致芯片无法进入下载模式。
- GPIO 被外设拉高或拉低，影响 strapping 电平。
- 目标 board 与实际芯片不匹配。

## 典型错误

`Failed to connect`：

- 通常是下载模式握手失败。
- 检查 BOOT、EN、串口、USB 数据线、启动脚外设。

`Invalid head of packet`：

- PC 与芯片通信异常。
- 可能是串口噪声、波特率、外设干扰启动、USB 线或端口问题。

`Timed out waiting for packet header`：

- 芯片没有进入预期通信状态。
- 检查下载模式、复位、串口占用。

## 串口监控失败

- 如果烧录成功但串口无日志，检查 `Serial.begin(115200)`。
- 如果日志乱码，检查波特率。
- 如果反复出现 `[BOOT]`，可能是重启循环、watchdog、brownout 或异常崩溃。
- 如果只有 bootloader 日志，没有应用日志，可能应用未正常启动。

## Embex 输出要求

诊断结果必须包含：

- 失败节点。
- 原始错误片段。
- 可能原因排序。
- 当前硬件配置中的相关风险。
- 下一步实验，例如断开某外设、换 GPIO、按 BOOT、换线、降低 upload speed。

