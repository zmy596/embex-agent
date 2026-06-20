#!/usr/bin/env python3
"""Self-test for ESP-series workflow tools."""

from __future__ import annotations

import sys
from pathlib import Path

from esp_platformio_tools import (
    esp_generate_firmware_task_project,
    esp_generate_project,
    esp_resolve_board,
    esp_run_closed_loop,
    esp_task_observation_check,
    esp_validate_gpio,
)


def main() -> int:
    failed = []

    gpio_ok = esp_validate_gpio()
    ok = gpio_ok["success"] is True
    print(f"gpio_default: expected=True actual={gpio_ok['success']} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("gpio_default", True, gpio_ok["success"]))

    generated = esp_generate_project(project_name="selftest_neutral_project")
    platformio_ini = Path(generated["project_dir"]) / "platformio.ini"
    main_cpp = Path(generated["project_dir"]) / "src" / "main.cpp"
    content = platformio_ini.read_text(encoding="utf-8")
    main_content = main_cpp.read_text(encoding="utf-8")
    ok = "No fixed peripherals are initialized." not in content and "[BOOT] Embex neutral ESP project start" in main_content
    print(f"neutral_project_template: expected=neutral_main actual={'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("neutral_project_template", "neutral_main", generated))

    classic_board = esp_resolve_board(board_model="ESP32 DevKit V1")["resolved"]
    ok = (
        classic_board["board_model"] == "esp32-devkit-v1"
        and classic_board["board"] == "esp32doit-devkit-v1"
        and classic_board["psram"] is False
        and classic_board["usb_cdc"] is False
    )
    print(f"board_resolve_esp32_devkit: expected=esp32doit-devkit-v1 actual={classic_board['board']} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("board_resolve_esp32_devkit", "esp32doit-devkit-v1", classic_board))

    c3_board = esp_resolve_board(board_model="ESP32-C3 DevKitM-1")["resolved"]
    ok = (
        c3_board["board_model"] == "esp32-c3-devkitm-1"
        and c3_board["board"] == "esp32-c3-devkitm-1"
        and c3_board["psram"] is False
        and c3_board["usb_cdc"] is True
    )
    print(f"board_resolve_esp32_c3: expected=esp32-c3-devkitm-1 actual={c3_board['board']} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("board_resolve_esp32_c3", "esp32-c3-devkitm-1", c3_board))

    firmware = esp_generate_firmware_task_project(
        task_description="?? LED",
        task="auto",
        project_name="selftest_led_task",
        board_model="esp32-s3-n8r8",
        led_pin=2,
    )
    task_main = Path(firmware["project_dir"]) / "src" / "main.cpp"
    task_main_content = task_main.read_text(encoding="utf-8")
    ok = firmware["success"] is True and firmware.get("task") == "led_on" and '#include "agent_peripherals.h"' in task_main_content
    print(f"firmware_task_led_generation: expected=led_on actual={firmware.get('task')} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("firmware_task_led_generation", "led_on", firmware.get("task")))

    task_observation = esp_task_observation_check(
        "[BOOT] Embex neutral ESP project start\n"
        "[SYSTEM] setup complete\n"
        "[HEARTBEAT] Embex neutral firmware running",
        "LED control"
    )
    ok = task_observation["success"] is True and task_observation["total"] >= 3
    print(f"task_observation_basic: expected=True actual={task_observation['success']} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("task_observation_basic", True, task_observation))

    loop_bad = esp_run_closed_loop(project_name="selftest_gpio_bad", sda_pin=8, scl_pin=8, led_pin=26)
    actual_root = loop_bad["diagnosis"]["root_cause"]
    ok = loop_bad["success"] is False and actual_root == "gpio_configuration_invalid" and [step["name"] for step in loop_bad["steps"]] == ["validate_gpio"]
    print(f"gpio_closed_loop_stop: expected=gpio_configuration_invalid actual={actual_root} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed.append(("gpio_closed_loop_stop", "gpio_configuration_invalid", actual_root))

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
