# Embex ESP Tools

This package provides Embex's ESP-series embedded workflow tools for PlatformIO projects.

Supported target families:

- ESP32
- ESP32-S3
- ESP32-C3
- ESP8266
- compatible ESP-series boards selected by `board_model` or raw PlatformIO `board`

## Architecture

Embex treats the firmware application as model-owned code:

```text
user task
  -> model plans and writes src/main.cpp
  -> tools generate PlatformIO project
  -> compile
  -> flash when a serial port is available
  -> serial monitor
  -> log diagnosis
  -> model summarizes or revises and retries
```

The generated project may include:

```text
src/main.cpp                 model-owned application
src/agent_peripherals.h      optional helper API
src/agent_peripherals.cpp    optional helper implementation
platformio.ini               board/platform configuration
esp_task.json                task metadata for diagnosis
```

## Peripheral Policy

Peripherals are optional. Use `-1` for every unconfigured pin.

Embex must not assume that LED, buzzer, AHT20, OLED, or I2C are connected unless the user configured them or explicitly asks to use them.

The helper API is available, but the model decides whether to call it:

```text
agentInit()
agentHeartbeat()
i2cInit()
oledInit()
oledShowChinese(line1, line2, line3)
ledInit()
ledSet(on)
ledBlink(periodMs, count)
buzzerInit()
buzzerBeep(freq, durationMs)
buzzerHappyBirthday()
aht20Init()
aht20Read(&temperature, &humidity)
```

`agentInit()` only logs core information and the configured pin map. It does not initialize I2C, OLED, LED, buzzer, or AHT20.

## OLED Notes

For a 6-pin SPI OLED with VCC/GND plus four signal pins:

```text
SCL/CLK -> oled_clk_pin
SDA/MOSI -> oled_mosi_pin
RES/RST -> oled_reset_pin
DC -> oled_dc_pin
CS -> not present, helper code uses U8X8_PIN_NONE
```

Set `oled_protocol=spi`. Do not reuse I2C `sda_pin/scl_pin` as an implicit fallback for SPI OLED.

For Chinese display, use U8g2 with `u8g2_font_wqy12_t_gb2312` and `drawUTF8`, or call `oledShowChinese(...)`.

## Main Tools

```text
esp_validate_gpio
esp_generate_firmware_task_project
esp_run_firmware_task
esp_compile_project
esp_flash_project
esp_monitor_serial
esp_list_serial_ports
esp_diagnose_log
esp_task_observation_check
```

`esp_task_observation_check` is only generic evidence checking. Final success should be judged against the current task. For example, a GPIO blink task needs compile/upload success plus serial evidence and physical LED observation; it should not require AHT20 or OLED logs.

## Verification

From the project root:

```powershell
python -m py_compile esp_agent\tools\esp_platformio_tools.py
npm run typecheck
```

Supported: ESP board
flash_size=16MB
memory_type=qio_opi
default_16MB.csv
[I2C] device found address=0x38
[I2C] device found address=0x3C
