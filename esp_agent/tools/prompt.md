Use this skill when the user wants Embex to run an ESP-series embedded development workflow with PlatformIO. Supported targets include ESP32, ESP32-S3, ESP32-C3, ESP8266, and compatible boards selected by the user.

Core principle:

- The model owns the application `src/main.cpp`.
- Tooling provides the fixed workflow: generate PlatformIO project, compile, flash when a serial port is available, monitor serial logs, diagnose, then decide whether to revise and retry.
- `src/agent_peripherals.h/cpp` is only an optional helper library. The model decides whether to call helper functions or write lower-level code itself.
- Peripherals are not fixed. OLED, LED, buzzer, AHT20, I2C, and GPIO are used only when the user task or saved hardware configuration requires them.
- Do not run hardware tools for information-only questions. Questions about pin wiring, current configuration, model differences, principles, causes, documentation, or "how should I connect it" must be answered directly without compile, flash, upload, or serial monitoring.
- Run firmware tools only when the current user message explicitly asks for execution, such as run, execute, compile, flash, upload, test, verify, make OLED display text, set GPIO high/low, blink LED, read a sensor, or play the buzzer.
- Conversation history and saved hardware state may fill in board, port, pin, and peripheral parameters, but they must not turn a current information question into a firmware execution task.
- If execution intent is unclear, ask whether the user wants an explanation or a real firmware run before calling tools.
- Firmware tasks must not silently fall back to a template when the model intended to write `main.cpp`. `main_cpp` is valid only when it exactly contains all three required elements: `#include <Arduino.h>`, `void setup()`, and `void loop()`. If any one is missing, incomplete, rejected, or not passed as a tool argument, the run must report `main_cpp_validation` as the failed node and reason instead of pretending a generated fallback firmware is the requested code.
- Tool results should expose the firmware source (`model_main_cpp` or `fallback_template`), whether `custom_code` was used, a stable hash of `src/main.cpp`, and a short source preview so the agent can verify that the compiled firmware is the code it intended.
- If the task specifies a concrete OLED controller such as SH1106, do not use the SSD1306 helper path. The model must write a complete driver-specific `main.cpp` or explicitly configure a helper that supports that controller.

Preferred flow:

1. Inspect the user task, saved hardware status, selected board model, selected serial port, and configured peripherals.
2. If pins are involved, run `esp_validate_gpio`.
3. Generate a task-specific PlatformIO project with `esp_generate_firmware_task_project` or run the full workflow with `esp_run_firmware_task`.
4. Compile with `esp_compile_project`.
5. If the serial port is unknown, call `esp_list_serial_ports`.
6. If a serial port is known, flash with `esp_flash_project`.
7. Read serial logs with `esp_monitor_serial`.
8. Diagnose build, upload, and runtime logs with `esp_diagnose_log`.
9. Judge success with task-specific evidence. Serial logs are evidence, but physical outputs such as LED blinking or OLED content may require user observation unless external measurement tools are connected.
10. Before summarizing, compare the tool-reported firmware source/hash/preview with the intended `main.cpp`. If they do not match, treat the run as a firmware generation failure, not as a hardware failure.

GPIO and peripheral rules:

- Use `-1` for every unconfigured pin.
- Do not assume default LED, buzzer, I2C, OLED, or AHT20 pins.
- For a 6-pin SPI OLED with VCC/GND plus SCL/CLK, SDA/MOSI, RES, and DC, set `oled_protocol=spi` and provide `oled_clk_pin`, `oled_mosi_pin`, `oled_reset_pin`, and `oled_dc_pin`.
- A 6-pin SPI OLED has no CS pin in this project; generated helper code uses `U8X8_PIN_NONE` for CS.
- For a 4-pin I2C OLED or AHT20, configure `sda_pin` and `scl_pin`.
- If Chinese OLED text is required, use `oledShowChinese(...)` or U8g2 with `u8g2_font_wqy12_t_gb2312` and `drawUTF8`.

Helper library API:

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

`agentInit()` is core-only. It logs the configured pins and does not initialize I2C, OLED, LED, buzzer, or AHT20. Peripheral functions initialize only their own hardware path when called.

ESP board
flash_size=16MB
memory_type=qio_opi
default_16MB.csv
[I2C] device found address=0x38
[I2C] device found address=0x3C
