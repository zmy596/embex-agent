#!/usr/bin/env python3
"""ESP-series PlatformIO closed-loop compile, flash, serial, and diagnosis tools."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import hashlib
from pathlib import Path
from typing import Any


DEFAULT_PROJECT = "embex_task"
DEFAULT_BOARD_MODEL = "luatos-esp32c3-core"
DEFAULT_BOARD = "esp32-c3-devkitm-1"
DEFAULT_FLASH_SIZE = "4MB"
DEFAULT_MEMORY_TYPE = ""
DEFAULT_PARTITIONS = "default.csv"
BOARD_PRESETS: dict[str, dict[str, Any]] = {
    "esp32-s3-n16r8": {
        "label": "ESP32-S3-N16R8",
        "board": "esp32-s3-devkitc-1",
        "flash_size": "16MB",
        "memory_type": "qio_opi",
        "partitions": "default_16MB.csv",
        "psram": True,
        "usb_cdc": True,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32s3",
    },
    "esp32-s3-n8r8": {
        "label": "ESP32-S3-N8R8",
        "board": "esp32-s3-devkitc-1",
        "flash_size": "8MB",
        "memory_type": "qio_opi",
        "partitions": "default_8MB.csv",
        "psram": True,
        "usb_cdc": True,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32s3",
    },
    "esp32-s3-n8": {
        "label": "ESP32-S3-N8",
        "board": "esp32-s3-devkitc-1",
        "flash_size": "8MB",
        "memory_type": "qio",
        "partitions": "default_8MB.csv",
        "psram": False,
        "usb_cdc": True,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32s3",
    },
    "esp32-s3-devkitc-1": {
        "label": "ESP32-S3-DevKitC-1",
        "board": "esp32-s3-devkitc-1",
        "flash_size": "8MB",
        "memory_type": "qio",
        "partitions": "default_8MB.csv",
        "psram": False,
        "usb_cdc": True,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32s3",
    },
    "esp32-c3-devkitm-1": {
        "label": "ESP32-C3-DevKitM-1",
        "board": "esp32-c3-devkitm-1",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "default.csv",
        "psram": False,
        "usb_cdc": True,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32c3",
    },
    "luatos-esp32c3-core": {
        "label": "LuatOS ESP32C3-CORE / 合宙 ESP32C3 核心板",
        "board": "esp32-c3-devkitm-1",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "default.csv",
        "psram": False,
        "usb_cdc": False,
        "flash_mode": "dio",
        "platform": "espressif32",
        "family": "esp32c3",
    },
    "esp32-c3-devkitc-02": {
        "label": "ESP32-C3-DevKitC-02",
        "board": "esp32-c3-devkitc-02",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "default.csv",
        "psram": False,
        "usb_cdc": True,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32c3",
    },
    "esp32-devkit-v1": {
        "label": "ESP32 DevKit V1 / ESP32-WROOM-32",
        "board": "esp32doit-devkit-v1",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "default.csv",
        "psram": False,
        "usb_cdc": False,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32",
    },
    "esp32-wrover": {
        "label": "ESP32-WROVER",
        "board": "esp-wrover-kit",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "default.csv",
        "psram": True,
        "usb_cdc": False,
        "flash_mode": "",
        "platform": "espressif32",
        "family": "esp32",
    },
    "esp8266-nodemcuv2": {
        "label": "ESP8266 NodeMCU 1.0 / ESP-12E",
        "board": "nodemcuv2",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "",
        "psram": False,
        "usb_cdc": False,
        "flash_mode": "dio",
        "platform": "espressif8266",
        "family": "esp8266",
    },
    "esp8266-d1-mini": {
        "label": "Wemos D1 mini / ESP8266",
        "board": "d1_mini",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "",
        "psram": False,
        "usb_cdc": False,
        "flash_mode": "dio",
        "platform": "espressif8266",
        "family": "esp8266",
    },
    "esp8266-esp12e": {
        "label": "Generic ESP8266 ESP-12E",
        "board": "esp12e",
        "flash_size": "4MB",
        "memory_type": "",
        "partitions": "",
        "psram": False,
        "usb_cdc": False,
        "flash_mode": "dio",
        "platform": "espressif8266",
        "family": "esp8266",
    },
}
FIRMWARE_TASKS = {
    "custom",
    "led_on",
    "led_off",
    "led_blink",
    "aht20_read",
    "oled_message",
    "buzzer_happy_birthday",
}


def _default_workspace() -> Path:
    return Path.home() / ".esp_agent" / "projects"


def _safe_project_name(value: str | None) -> str:
    raw = str(value or DEFAULT_PROJECT).strip()
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw).strip("._")
    return safe or DEFAULT_PROJECT


def esp32_s3_resolve_board(
    board_model: str = DEFAULT_BOARD_MODEL,
    board: str = "",
    flash_size: str = "",
    memory_type: str = "",
    partitions: str = "",
) -> dict[str, Any]:
    """Resolve a human board/module model to PlatformIO build parameters."""

    preset_key = _normalize_board_model(board_model)
    preset = BOARD_PRESETS.get(preset_key, BOARD_PRESETS[DEFAULT_BOARD_MODEL])
    resolved = {
        "board_model": preset_key,
        "label": preset["label"],
        "board": str(board or preset["board"]),
        "flash_size": str(flash_size or preset["flash_size"]),
        "memory_type": str(memory_type if memory_type != "" else preset["memory_type"]),
        "partitions": str(partitions or preset["partitions"]),
        "psram": bool(preset["psram"]),
        "usb_cdc": bool(preset["usb_cdc"]),
        "flash_mode": str(preset.get("flash_mode") or ""),
        "platform": str(preset.get("platform") or "espressif32"),
        "family": str(preset.get("family") or "esp32"),
    }
    return {
        "success": True,
        "resolved": resolved,
        "supported_models": [
            {
                "id": key,
                "label": value["label"],
                "board": value["board"],
                "flash_size": value["flash_size"],
                "memory_type": value["memory_type"],
                "partitions": value["partitions"],
                "psram": value["psram"],
                "usb_cdc": value["usb_cdc"],
                "flash_mode": value.get("flash_mode", ""),
                "platform": value.get("platform", "espressif32"),
                "family": value.get("family", "esp32"),
            }
            for key, value in BOARD_PRESETS.items()
        ],
        "summary": f"Resolved {board_model or DEFAULT_BOARD_MODEL} to PlatformIO board {resolved['board']}.",
    }


def _run_command(args: list[str], cwd: Path, timeout: int = 120) -> dict[str, Any]:
    started = time.time()
    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return {
            "success": proc.returncode == 0,
            "command": " ".join(args),
            "exit_code": proc.returncode,
            "duration_sec": round(time.time() - started, 2),
            "log": proc.stdout,
        }
    except FileNotFoundError:
        return {
            "success": False,
            "command": " ".join(args),
            "exit_code": 127,
            "duration_sec": round(time.time() - started, 2),
            "log": f"Command not found: {args[0]}. Install PlatformIO or add it to PATH.",
        }
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        return {
            "success": False,
            "command": " ".join(args),
            "exit_code": 124,
            "duration_sec": round(time.time() - started, 2),
            "log": f"Command timed out after {timeout}s.\n{output}",
        }


def _clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def _platformio_command(*args: str) -> list[str]:
    return [sys.executable, "-m", "platformio", *args]


def _platformio_status() -> dict[str, Any]:
    result: dict[str, Any] = {
        "python": sys.executable,
        "pyserial": None,
        "pio": None,
        "pio_ok": False,
    }
    try:
        import serial  # type: ignore

        result["pyserial"] = serial.VERSION
    except Exception as exc:
        result["pyserial_error"] = str(exc)
    try:
        proc = subprocess.run(
            _platformio_command("--version"),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=30,
            encoding="utf-8",
            errors="replace",
        )
        result["pio"] = proc.stdout.strip()
        result["pio_ok"] = proc.returncode == 0
    except Exception as exc:
        result["pio_error"] = str(exc)
    return result


def esp32_s3_generate_project(
    project_name: str = DEFAULT_PROJECT,
    board_model: str = DEFAULT_BOARD_MODEL,
    board: str = "",
    flash_size: str = "",
    memory_type: str = "",
    partitions: str = "",
    sda_pin: int = -1,
    scl_pin: int = -1,
    oled_clk_pin: int = -1,
    oled_mosi_pin: int = -1,
    oled_reset_pin: int = -1,
    oled_dc_pin: int = -1,
    oled_protocol: str = "auto",
    led_pin: int = -1,
    buzzer_pin: int = -1,
    workspace: str | None = None,
) -> dict[str, Any]:
    """Generate a neutral PlatformIO Arduino project for an ESP-series board."""

    root = Path(workspace).expanduser() if workspace else _default_workspace()
    project_dir = root / _safe_project_name(project_name)
    src_dir = project_dir / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    board_config = esp32_s3_resolve_board(
        board_model=board_model,
        board=board,
        flash_size=flash_size,
        memory_type=memory_type,
        partitions=partitions,
    )["resolved"]

    platformio_ini = _platformio_ini(
        board=str(board_config["board"]),
        flash_size=str(board_config["flash_size"]),
        memory_type=str(board_config["memory_type"]),
        partitions=str(board_config["partitions"]),
        psram=bool(board_config["psram"]),
        usb_cdc=bool(board_config["usb_cdc"]),
        flash_mode=str(board_config.get("flash_mode") or ""),
        platform=str(board_config.get("platform") or "espressif32"),
    )
    main_cpp = _main_cpp(
        sda_pin=int(sda_pin),
        scl_pin=int(scl_pin),
        oled_reset_pin=int(oled_reset_pin),
        oled_dc_pin=int(oled_dc_pin),
        led_pin=int(led_pin),
        buzzer_pin=int(buzzer_pin),
    )

    (project_dir / "platformio.ini").write_text(platformio_ini, encoding="utf-8")
    (src_dir / "main.cpp").write_text(main_cpp, encoding="utf-8")
    (project_dir / "esp_pins.json").write_text(
        json.dumps(
            {
                "board_model": board_config["board_model"],
                "board_label": board_config["label"],
                "board": board_config["board"],
                "flash_size": board_config["flash_size"],
                "memory_type": board_config["memory_type"],
                "partitions": board_config["partitions"],
                "psram": board_config["psram"],
                "usb_cdc": board_config["usb_cdc"],
                "flash_mode": board_config.get("flash_mode", ""),
                "platform": board_config.get("platform", "espressif32"),
                "family": board_config.get("family", "esp32"),
                "sda_pin": int(sda_pin),
                "scl_pin": int(scl_pin),
                "oled_reset_pin": int(oled_reset_pin),
                "oled_dc_pin": int(oled_dc_pin),
                "led_pin": int(led_pin),
                "buzzer_pin": int(buzzer_pin),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return {
        "success": True,
        "project_dir": str(project_dir),
        "files": [
            str(project_dir / "platformio.ini"),
            str(src_dir / "main.cpp"),
            str(project_dir / "esp_pins.json"),
        ],
        "board": board_config,
        "summary": f"Generated neutral PlatformIO project for {board_config['label']}. No fixed peripherals are initialized.",
    }


def esp32_s3_generate_firmware_task_project(
    task: str = "custom",
    task_description: str = "",
    custom_code: str = "",
    project_name: str | None = None,
    board_model: str = DEFAULT_BOARD_MODEL,
    board: str = "",
    flash_size: str = "",
    memory_type: str = "",
    partitions: str = "",
    sda_pin: int = -1,
    scl_pin: int = -1,
    oled_clk_pin: int = -1,
    oled_mosi_pin: int = -1,
    oled_reset_pin: int = -1,
    oled_dc_pin: int = -1,
    oled_protocol: str = "auto",
    led_pin: int = -1,
    buzzer_pin: int = -1,
    oled_text: str = "Hello from Embex",
    workspace: str | None = None,
) -> dict[str, Any]:
    """Generate a PlatformIO project for a concrete firmware task."""

    normalized_task = _infer_firmware_task(task_description) if str(task or "").strip().lower() in {"", "auto"} else _normalize_firmware_task(task)
    name = project_name or f"esp_task_{normalized_task}"
    root = Path(workspace).expanduser() if workspace else _default_workspace()
    project_dir = root / _safe_project_name(name)
    src_dir = project_dir / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    board_config = esp32_s3_resolve_board(
        board_model=board_model,
        board=board,
        flash_size=flash_size,
        memory_type=memory_type,
        partitions=partitions,
    )["resolved"]

    (project_dir / "platformio.ini").write_text(
        _platformio_ini(
            board=str(board_config["board"]),
            flash_size=str(board_config["flash_size"]),
            memory_type=str(board_config["memory_type"]),
            partitions=str(board_config["partitions"]),
            psram=bool(board_config["psram"]),
            usb_cdc=bool(board_config["usb_cdc"]),
            flash_mode=str(board_config.get("flash_mode") or ""),
            platform=str(board_config.get("platform") or "espressif32"),
        ),
        encoding="utf-8",
    )
    agent_header = _agent_peripherals_h()
    agent_cpp = _agent_peripherals_cpp(
        sda_pin=int(sda_pin),
        scl_pin=int(scl_pin),
        oled_clk_pin=int(oled_clk_pin),
        oled_mosi_pin=int(oled_mosi_pin),
        oled_reset_pin=int(oled_reset_pin),
        oled_dc_pin=int(oled_dc_pin),
        oled_protocol=str(oled_protocol or "auto"),
        led_pin=int(led_pin),
        buzzer_pin=int(buzzer_pin),
    )
    (src_dir / "agent_peripherals.h").write_text(agent_header, encoding="utf-8")
    (src_dir / "agent_peripherals.cpp").write_text(agent_cpp, encoding="utf-8")

    main_cpp = str(custom_code or "").strip()
    normalization_findings: list[dict[str, str]] = []
    if main_cpp:
        firmware_source = "model_main_cpp"
        main_cpp, normalization_findings = _sanitize_custom_oled_literals(main_cpp)
        validation = _validate_custom_firmware_code(main_cpp)
        if not validation["success"]:
            return {
                "success": False,
                "task": normalized_task,
                "project_dir": str(project_dir),
                "summary": validation["summary"],
                "findings": normalization_findings + validation["findings"],
            }
    else:
        firmware_source = "fallback_template"
        main_cpp = _model_owned_main_cpp(
            task=normalized_task,
            oled_text=str(oled_text or "Hello from Embex"),
        )
    main_cpp_hash = hashlib.sha256(main_cpp.encode("utf-8")).hexdigest()
    (src_dir / "main.cpp").write_text(main_cpp, encoding="utf-8")
    (project_dir / "esp_task.json").write_text(
        json.dumps(
            {
                "task": normalized_task,
                "task_description": str(task_description or ""),
                "custom_code": bool(custom_code),
                "firmware_source": firmware_source,
                "main_cpp_hash": main_cpp_hash,
                "main_cpp_preview": _preview_source(main_cpp),
                "firmware_library": True,
                "main_cpp_owner": "model_or_task_planner",
                "library_files": ["src/agent_peripherals.h", "src/agent_peripherals.cpp"],
                "library_api": [
                    "agentInit",
                    "agentHeartbeat",
                    "i2cInit",
                    "oledInit",
                    "oledShowChinese",
                    "ledInit",
                    "ledSet",
                    "ledBlink",
                    "buzzerInit",
                    "buzzerBeep",
                    "buzzerHappyBirthday",
                    "aht20Init",
                    "aht20Read",
                ],
                "board_model": board_config["board_model"],
                "board_label": board_config["label"],
                "board": board_config["board"],
                "flash_size": board_config["flash_size"],
                "memory_type": board_config["memory_type"],
                "partitions": board_config["partitions"],
                "psram": board_config["psram"],
                "usb_cdc": board_config["usb_cdc"],
                "flash_mode": board_config.get("flash_mode", ""),
                "platform": board_config.get("platform", "espressif32"),
                "family": board_config.get("family", "esp32"),
                "sda_pin": int(sda_pin),
                "scl_pin": int(scl_pin),
                "oled_clk_pin": int(oled_clk_pin),
                "oled_mosi_pin": int(oled_mosi_pin),
                "oled_reset_pin": int(oled_reset_pin),
                "oled_dc_pin": int(oled_dc_pin),
                "oled_protocol": _resolve_oled_protocol(str(oled_protocol or "auto"), int(oled_dc_pin)),
                "led_pin": int(led_pin),
                "buzzer_pin": int(buzzer_pin),
                "oled_text": str(oled_text or ""),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return {
        "success": True,
        "task": normalized_task,
        "project_dir": str(project_dir),
        "files": [
            str(project_dir / "platformio.ini"),
            str(src_dir / "main.cpp"),
            str(src_dir / "agent_peripherals.h"),
            str(src_dir / "agent_peripherals.cpp"),
            str(project_dir / "esp_task.json"),
        ],
        "board": board_config,
        "firmware_source": firmware_source,
        "main_cpp_hash": main_cpp_hash,
        "main_cpp_preview": _preview_source(main_cpp),
        "findings": normalization_findings,
        "summary": f"Generated model-owned main.cpp project for {board_config['label']}: {normalized_task}. Peripheral helper library is available in agent_peripherals.h/cpp.",
    }


def esp32_s3_validate_gpio(
    board_model: str = DEFAULT_BOARD_MODEL,
    sda_pin: int = -1,
    scl_pin: int = -1,
    oled_clk_pin: int = -1,
    oled_mosi_pin: int = -1,
    oled_reset_pin: int = -1,
    oled_dc_pin: int = -1,
    oled_protocol: str = "auto",
    led_pin: int = -1,
    buzzer_pin: int = -1,
) -> dict[str, Any]:
    """Validate GPIO choices before generating/flashing firmware."""

    board_config = esp32_s3_resolve_board(board_model=board_model)["resolved"]
    family = str(board_config.get("family") or "esp32")
    usb_cdc = bool(board_config.get("usb_cdc"))
    resolved_oled_protocol = _resolve_oled_protocol(str(oled_protocol or "auto"), int(oled_dc_pin))
    roles = {
        "SDA": int(sda_pin),
        "SCL": int(scl_pin),
        "OLED_CLK": int(oled_clk_pin),
        "OLED_MOSI": int(oled_mosi_pin),
        "OLED_RES": int(oled_reset_pin),
        "OLED_DC": int(oled_dc_pin),
        "LED": int(led_pin),
        "BUZZER": int(buzzer_pin),
    }
    disabled_ok = {"SDA", "SCL", "OLED_CLK", "OLED_MOSI", "OLED_RES", "OLED_DC", "LED", "BUZZER"}
    findings: list[dict[str, str]] = []

    def add(kind: str, severity: str, role: str, gpio: int, message: str) -> None:
        findings.append(
            {
                "kind": kind,
                "severity": severity,
                "role": role,
                "gpio": str(gpio),
                "message": message,
            }
        )

    for role, gpio in roles.items():
        if gpio == -1:
            if role not in disabled_ok:
                add("required_pin_disabled", "critical", role, gpio, f"{role} cannot be disabled.")
            continue
        if family == "esp8266":
            if gpio < 0 or gpio > 16:
                add("gpio_out_of_range", "critical", role, gpio, "ESP8266 GPIO should be -1 or 0..16.")
            if gpio in {6, 7, 8, 9, 10, 11}:
                add("spi_flash_risk", "critical", role, gpio, "GPIO6-11 are usually connected to ESP8266 SPI flash; do not use them for external wiring.")
            if gpio in {0, 2, 15}:
                add("strapping_pin", "warning", role, gpio, "GPIO0/2/15 affect ESP8266 boot mode; external circuits must keep the required boot levels.")
            if gpio == 16 and role in {"SDA", "SCL"}:
                add("i2c_pin_risk", "warning", role, gpio, "GPIO16 has limitations on ESP8266 and is not a good I2C choice.")
        else:
            if gpio < 0 or gpio > 48:
                add("gpio_out_of_range", "critical", role, gpio, "ESP32-family GPIO should be -1 or 0..48.")
            if gpio in {19, 20} and family == "esp32s3":
                add("usb_cdc_pin", "warning", role, gpio, "GPIO19/20 are commonly USB D-/D+ on ESP32-S3; avoid unless the board documents them as free.")
            if gpio in {18, 19} and family == "esp32c3" and usb_cdc:
                add("usb_cdc_pin", "warning", role, gpio, "GPIO18/19 are commonly USB D-/D+ on ESP32-C3 native USB boards; avoid unless this board uses an external USB-UART or documents them as free.")
            if gpio in {0, 3, 45, 46}:
                add("strapping_pin", "warning", role, gpio, "Boot strapping pins can affect startup or flashing; use only with care.")
            if gpio in {26, 27, 28, 29, 30, 31, 32} and family == "esp32s3":
                add("spi_flash_psram_risk", "critical", role, gpio, "This GPIO range is commonly tied to SPI flash/PSRAM on ESP32-S3 modules; avoid for external wiring.")
            if gpio in {39, 40, 41, 42} and family == "esp32s3":
                add("jtag_pin", "info", role, gpio, "This GPIO may be used by JTAG on some ESP32-S3 boards; avoid if debugging over JTAG.")

    used: dict[int, list[str]] = {}
    for role, gpio in roles.items():
        if gpio >= 0:
            used.setdefault(gpio, []).append(role)
    for gpio, role_names in used.items():
        if len(role_names) > 1:
            add("gpio_conflict", "critical", "/".join(role_names), gpio, f"GPIO{gpio} is assigned to multiple roles: {', '.join(role_names)}.")

    if resolved_oled_protocol == "spi":
        if int(oled_clk_pin) < 0:
            add("spi_oled_pin_missing", "critical", "OLED_CLK", int(oled_clk_pin), "SPI OLED requires an explicit CLK/SCK GPIO; do not fall back to I2C SCL.")
        if int(oled_mosi_pin) < 0:
            add("spi_oled_pin_missing", "critical", "OLED_MOSI", int(oled_mosi_pin), "SPI OLED requires an explicit MOSI/DIN GPIO; do not fall back to I2C SDA.")
        if int(oled_dc_pin) < 0:
            add("spi_oled_pin_missing", "critical", "OLED_DC", int(oled_dc_pin), "SPI OLED requires an explicit DC GPIO.")

    has_critical = any(item["severity"] == "critical" for item in findings)
    has_warning = any(item["severity"] == "warning" for item in findings)
    return {
        "success": not has_critical,
        "summary": "GPIO configuration accepted." if not findings else "GPIO configuration has risks.",
        "severity": "critical" if has_critical else "warning" if has_warning else "info",
        "board": board_config,
        "pins": roles,
        "findings": findings,
    }


def esp32_s3_compile_project(project_dir: str, timeout_seconds: int = 600) -> dict[str, Any]:
    """Run `pio run` for a generated project."""

    path = Path(project_dir).expanduser()
    if not (path / "platformio.ini").exists():
        return {
            "success": False,
            "project_dir": str(path),
            "summary": "platformio.ini not found.",
            "diagnosis": esp32_s3_diagnose_log("platformio.ini not found"),
        }
    result = _run_command(_platformio_command("run"), path, timeout=_clamp_int(timeout_seconds, 60, 1800, 600))
    result["project_dir"] = str(path)
    result["summary"] = "Build succeeded." if result["success"] else _summarize_log(result["log"])
    result["diagnosis"] = esp32_s3_diagnose_log(result["log"])
    return result


def esp32_s3_flash_project(project_dir: str, port: str | None = None, timeout_seconds: int = 180) -> dict[str, Any]:
    """Upload a PlatformIO project to ESP32-S3."""

    path = Path(project_dir).expanduser()
    args = _platformio_command("run", "-t", "upload")
    if port:
        args.extend(["--upload-port", str(port)])
    result = _run_command(args, path, timeout=_clamp_int(timeout_seconds, 30, 600, 180))
    result["project_dir"] = str(path)
    result["port"] = port or ""
    result["summary"] = "Upload succeeded." if result["success"] else _summarize_log(result["log"])
    result["diagnosis"] = esp32_s3_diagnose_log(result["log"])
    return result


def esp32_s3_monitor_serial(port: str, baud: int = 115200, seconds: float = 8.0) -> dict[str, Any]:
    """Read serial output from a board for a fixed duration."""

    try:
        import serial  # type: ignore
    except Exception:
        return {
            "success": False,
            "port": port,
            "baud": baud,
            "log": "Python package pyserial is not installed. Run: python -m pip install pyserial",
            "diagnosis": esp32_s3_diagnose_log("pyserial is not installed"),
        }

    lines: list[str] = []
    started = time.time()
    try:
        with serial.Serial(port=port, baudrate=int(baud), timeout=0.2) as ser:
            time.sleep(0.4)
            while time.time() - started < float(seconds):
                data = ser.readline()
                if data:
                    lines.append(data.decode("utf-8", errors="replace").rstrip())
    except Exception as exc:
        log = f"Serial monitor failed on {port}: {exc}"
        return {
            "success": False,
            "port": port,
            "baud": baud,
            "duration_sec": round(time.time() - started, 2),
            "log": log,
            "diagnosis": esp32_s3_diagnose_log(log),
        }

    log = "\n".join(lines)
    success = bool(lines)
    return {
        "success": success,
        "port": port,
        "baud": baud,
        "duration_sec": round(time.time() - started, 2),
        "log": log,
        "summary": "Serial output captured." if success else "No serial output captured.",
        "diagnosis": esp32_s3_diagnose_log(log or "No serial output captured"),
    }


def esp32_s3_list_serial_ports() -> dict[str, Any]:
    """List serial ports visible to pyserial."""

    try:
        from serial.tools import list_ports  # type: ignore
    except Exception as exc:
        return {
            "success": False,
            "ports": [],
            "summary": f"pyserial list_ports is unavailable: {exc}",
            "diagnosis": esp32_s3_diagnose_log("pyserial list_ports unavailable"),
        }

    seen: set[str] = set()
    ports = []
    for item in list_ports.comports():
        if item.device in seen:
            continue
        seen.add(item.device)
        text = " ".join(
            str(part or "")
            for part in [item.device, item.description, item.hwid, item.manufacturer]
        ).lower()
        is_bluetooth = "bthenum" in text or "bluetooth" in text
        is_usb_candidate = (not is_bluetooth) and any(
            marker in text
            for marker in [
                "usb",
                "uart",
                "serial",
                "ch343",
                "ch340",
                "cp210",
                "silicon labs",
                "wch",
                "espressif",
            ]
        )
        ports.append(
            {
                "device": item.device,
                "description": item.description,
                "hwid": item.hwid,
                "vid": item.vid,
                "pid": item.pid,
                "manufacturer": item.manufacturer,
                "serial_number": item.serial_number,
                "is_usb_candidate": is_usb_candidate,
                "is_bluetooth": is_bluetooth,
            }
        )
    ports.sort(key=lambda port: (not port["is_usb_candidate"], port["is_bluetooth"], port["device"]))
    return {
        "success": True,
        "ports": ports,
        "summary": f"Found {len(ports)} serial port(s).",
    }


def esp32_s3_preflight() -> dict[str, Any]:
    """Check local toolchain and USB-UART upload readiness."""

    result = _platformio_status()
    ports = esp32_s3_list_serial_ports()
    usb_candidates = [port for port in ports.get("ports", []) if port.get("is_usb_candidate")]
    result["ports"] = ports
    result["selftest"] = {
        "success": bool(result.get("pio_ok") and result.get("pyserial")),
        "checks": [
            {"name": "platformio", "ok": bool(result.get("pio_ok"))},
            {"name": "pyserial", "ok": bool(result.get("pyserial"))},
        ],
    }
    result["ready_for_compile"] = bool(result.get("pio_ok") and result.get("pyserial"))
    result["ready_for_upload"] = bool(result["ready_for_compile"] and usb_candidates)
    result["next_step"] = (
        "Select a USB-UART serial port and run the ESP workflow."
        if result["ready_for_upload"]
        else "Connect an ESP board through a USB data cable, install the USB-UART driver, then refresh serial ports."
    )
    return result


def esp32_s3_diagnose_log(log: str) -> dict[str, Any]:
    """Diagnose build, upload, and runtime logs."""

    text = str(log or "")
    lower = text.lower()
    findings: list[dict[str, Any]] = []

    def add(kind: str, severity: str, evidence: str, action: str) -> None:
        findings.append(
            {
                "kind": kind,
                "severity": severity,
                "evidence": evidence,
                "action": action,
            }
        )

    if "command timed out" in lower and ("tool manager: installing" in lower or "downloading" in lower or "unpacking" in lower):
        add("platformio_dependency_timeout", "warning", _first_matching_line(text, "Command timed out"), "PlatformIO was still installing board packages. Retry the build after dependencies finish caching.")
    if "command not found: pio" in lower or "'pio'" in lower and "not recognized" in lower:
        add("toolchain_missing", "critical", "PlatformIO is unavailable in the active Python environment.", "Install PlatformIO in the ESP Agent Python environment: python -m pip install platformio.")
    if "dependency conflicts" in lower and "successfully installed" in lower:
        add("platformio_tool_installed_with_warning", "info", _first_matching_line(text, "dependency conflicts"), "This pip resolver warning appeared while PlatformIO installed tool dependencies; retry pio run before changing source code.")
    if "fatal error" in lower and "no such file" in lower:
        add("missing_header_or_library", "critical", _first_matching_line(text, "fatal error"), "Check lib_deps in platformio.ini and include names.")
    if "error:" in lower and not findings:
        add("compile_error", "critical", _first_matching_line(text, "error:"), "Review the compiler error line and patch src/main.cpp.")
    if "this chip is esp32-c3, not esp32-s3" in lower or "wrong --chip argument" in lower:
        add("board_model_mismatch", "critical", _first_matching_line(text, "Wrong --chip argument") or _first_matching_line(text, "This chip is"), "The selected PlatformIO board does not match the connected chip. Use the hardware configuration board_model, for example luatos-esp32c3-core for the LuatOS ESP32C3 core board.")
    if "failed to connect" in lower or "timed out waiting for packet header" in lower:
        add("upload_connect_failed", "critical", _first_matching_line(text, "Failed") or _first_matching_line(text, "timed out"), "Hold BOOT during upload, verify the USB data cable, driver, and selected COM port.")
    if "could not open port" in lower or "access is denied" in lower or "permission" in lower:
        add("serial_port_unavailable", "critical", _first_matching_line(text, "port") or _first_matching_line(text, "Access"), "Close other serial monitors and verify CH343/USB driver installation.")
    if "brownout detector was triggered" in lower or "brownout" in lower:
        add("power_brownout", "critical", "brownout detector was triggered", "Check USB cable, 5V supply current, wiring shorts, and add decoupling capacitance.")
    if "guru meditation" in lower or "panic" in lower:
        add("esp32_panic", "critical", _first_matching_line(text, "Guru") or _first_matching_line(text, "panic"), "Inspect stack trace, invalid pointers, and peripheral initialization order.")
    if _has_line_with(text, "aht20", ("not found", "init failed", "read failed")):
        add("aht20_i2c_fault", "warning", _first_line_with(text, "AHT20", ("not found", "init failed", "read failed")), "Check AHT20 VCC=3V3, GND, SDA/SCL, address 0x38, and shared I2C bus wiring.")
    if _has_line_with(text, "oled", ("init failed", "not found")):
        add("oled_i2c_fault", "warning", _first_line_with(text, "OLED", ("init failed", "not found")), "Check OLED VCC/GND/SCL/SDA/RES wiring and address 0x3C.")
    if "no serial output" in lower:
        add("no_serial_output", "warning", "No serial output captured", "Check baud rate 115200, port, reset state, USB CDC settings, and whether firmware booted.")
    if "[success]" in lower and ("platformio" in lower or "building in release mode" in lower or "checking size" in lower):
        add("build_ok", "info", _first_matching_line(text, "[SUCCESS]"), "Firmware build succeeded; provide a COM port to continue upload and serial verification.")
    if "skipped because no serial port was provided" in lower:
        add("awaiting_serial_port", "info", "Skipped because no serial port was provided.", "Select the ESP32-S3 USB-UART COM port to continue upload and serial verification.")
    if "[system] ok" in lower or "[data]" in lower:
        add("runtime_ok", "info", _first_matching_line(text, "[DATA]") or "[SYSTEM] ok", "Runtime telemetry is present; continue monitoring for intermittent faults.")
    if "[oled] display update" in lower:
        add("oled_display_active", "info", _first_matching_line(text, "[OLED] display update"), "OLED display update log is present; visually confirm the panel shows the same status.")
    if "[led] state=on" in lower or "[led] toggle" in lower:
        add("led_control_active", "info", _first_matching_line(text, "[LED]"), "LED control log is present; visually confirm the external LED follows the reported state.")
    if "[buzzer] tone" in lower:
        add("buzzer_control_active", "info", _first_matching_line(text, "[BUZZER] tone"), "Buzzer control log is present; listen for the corresponding tone during the run.")

    if not findings:
        findings.append(
            {
                "kind": "unknown",
                "severity": "info",
                "evidence": "No known ESP32-S3 fault pattern matched.",
                "action": "Keep the raw log and add a new diagnosis rule if this repeats.",
            }
        )

    root_cause = _choose_root_cause(findings)
    return {
        "success": True,
        "root_cause": root_cause,
        "confidence": _confidence(findings),
        "findings": findings,
        "next_step": findings[0]["action"],
    }


def esp32_task_observation_check(log: str, task_description: str = "") -> dict[str, Any]:
    """Check task-level runtime evidence without assuming a fixed peripheral set."""

    text = str(log or "")
    lower = text.lower()
    checks = [
        _observation_item(
            "serial_output",
            "Serial output captured",
            bool(text.strip()),
            "any serial output",
            "If no serial output was captured, check baud rate, reset timing, USB-UART port, and whether firmware reached setup().",
        ),
        _observation_item(
            "boot_or_setup",
            "Boot/setup evidence",
            bool(_first_matching_line(text, "[BOOT]") or _first_matching_line(text, "[SYSTEM] setup") or _first_matching_line(text, "[APP] setup")),
            "[BOOT] or [SYSTEM] setup",
            "Add explicit Serial.println markers in setup() and reset the board after flashing.",
        ),
        _observation_item(
            "no_crash_reset",
            "No crash/reset signature",
            not any(marker in lower for marker in ["brownout", "watchdog", "rst:", "guru meditation", "panic", "exception"]),
            "no brownout/watchdog/panic/reset loop",
            "Inspect power, boot logs, watchdog blocking code, and invalid GPIO/peripheral initialization.",
        ),
    ]

    task = str(task_description or "").lower()
    if "gpio" in task or "led" in task or "闪" in task or "电平" in task:
        checks.append(_observation_item("gpio_task_log", "GPIO/LED task log", bool(_first_matching_line(text, "[GPIO]") or _first_matching_line(text, "[LED]") or _first_matching_line(text, "[SYSTEM] setup complete")), "[GPIO] or [LED] runtime log", "Use serial log plus physical observation or multimeter/logic analyzer to confirm the pin level."))
    if "oled" in task or "显示" in task or "屏" in task:
        checks.append(_observation_item("oled_task_log", "OLED task log", bool(_first_matching_line(text, "[OLED]")), "[OLED] init/update log", "Check OLED protocol, CLK/MOSI/RES/DC pins, power, and whether the screen physically changed."))
    if "aht20" in task or "温度" in task or "湿度" in task:
        checks.append(_observation_item("aht20_task_log", "AHT20 task log", bool(_first_matching_line(text, "[AHT20]")), "[AHT20] runtime log", "Check AHT20 VCC/GND/SDA/SCL, I2C pull-ups, and address 0x38."))
    if "蜂鸣" in task or "buzzer" in task or "生日快乐" in task:
        checks.append(_observation_item("buzzer_task_log", "Buzzer task log", bool(_first_matching_line(text, "[BUZZER]")), "[BUZZER] runtime log", "Check buzzer driver GPIO, transistor wiring, supply, and shared ground."))

    missing = [item for item in checks if not item["passed"]]
    return {
        "success": not missing,
        "passed": len(checks) - len(missing),
        "total": len(checks),
        "checks": checks,
        "missing": missing,
        "summary": "Task-level runtime evidence complete." if not missing else f"Task-level runtime evidence incomplete: {len(missing)} item(s) missing.",
        "next_step": "Confirm physical output for this specific task." if not missing else missing[0]["action"],
    }


def esp32_s3_run_closed_loop(
    project_name: str = DEFAULT_PROJECT,
    board_model: str = DEFAULT_BOARD_MODEL,
    board: str = "",
    port: str | None = None,
    flash_size: str = "",
    memory_type: str = "",
    partitions: str = "",
    sda_pin: int = -1,
    scl_pin: int = -1,
    oled_clk_pin: int = -1,
    oled_mosi_pin: int = -1,
    oled_reset_pin: int = -1,
    oled_dc_pin: int = -1,
    oled_protocol: str = "auto",
    led_pin: int = -1,
    buzzer_pin: int = -1,
    compile_timeout_sec: int = 600,
    upload_timeout_sec: int = 180,
    monitor_seconds: float = 8.0,
) -> dict[str, Any]:
    """Run a practical closed loop. Flash/monitor are skipped if port is not provided."""

    steps: list[dict[str, Any]] = []
    gpio_validation = esp32_s3_validate_gpio(
        board_model=board_model,
        sda_pin=sda_pin,
        scl_pin=scl_pin,
        oled_clk_pin=oled_clk_pin,
        oled_mosi_pin=oled_mosi_pin,
        oled_reset_pin=oled_reset_pin,
        oled_dc_pin=oled_dc_pin,
        led_pin=led_pin,
        buzzer_pin=buzzer_pin,
    )
    steps.append({"name": "validate_gpio", "result": gpio_validation})
    if not gpio_validation["success"]:
        return _closed_loop_result(steps)

    generated = esp32_s3_generate_project(
        project_name=project_name,
        board_model=board_model,
        board=board,
        flash_size=flash_size,
        memory_type=memory_type,
        partitions=partitions,
        sda_pin=sda_pin,
        scl_pin=scl_pin,
        oled_reset_pin=oled_reset_pin,
        oled_dc_pin=oled_dc_pin,
        led_pin=led_pin,
        buzzer_pin=buzzer_pin,
    )
    steps.append({"name": "generate_project", "result": generated})
    if not generated["success"]:
        return _closed_loop_result(steps)

    project_dir = generated["project_dir"]
    compiled = esp32_s3_compile_project(project_dir, timeout_seconds=compile_timeout_sec)
    steps.append({"name": "compile", "result": compiled})
    if not compiled["success"]:
        return _closed_loop_result(steps)

    if port:
        flashed = esp32_s3_flash_project(project_dir, port=port, timeout_seconds=upload_timeout_sec)
        steps.append({"name": "flash", "result": flashed})
        if flashed["success"]:
            monitored = esp32_s3_monitor_serial(port=port, baud=115200, seconds=_clamp_float(monitor_seconds, 1.0, 120.0, 8.0))
            steps.append({"name": "monitor", "result": monitored})
            observation = esp32_task_observation_check(monitored.get("log", ""), task_description)
            steps.append({"name": "task_observation_check", "result": observation})
    else:
        steps.append(
            {
                "name": "flash",
                "result": {
                    "success": None,
                    "summary": "Skipped because no serial port was provided.",
                    "next_step": "Provide the board COM port to flash and monitor real hardware.",
                },
            }
        )
    return _closed_loop_result(steps)


def esp32_s3_run_firmware_task(
    task_description: str,
    task: str = "auto",
    custom_code: str = "",
    project_name: str | None = None,
    board_model: str = DEFAULT_BOARD_MODEL,
    board: str = "",
    port: str | None = None,
    flash_size: str = "",
    memory_type: str = "",
    partitions: str = "",
    sda_pin: int = -1,
    scl_pin: int = -1,
    oled_clk_pin: int = -1,
    oled_mosi_pin: int = -1,
    oled_reset_pin: int = -1,
    oled_dc_pin: int = -1,
    oled_protocol: str = "auto",
    led_pin: int = -1,
    buzzer_pin: int = -1,
    oled_text: str = "Hello from Embex",
    compile_timeout_sec: int = 600,
    upload_timeout_sec: int = 180,
    monitor_seconds: float = 8.0,
) -> dict[str, Any]:
    """Generate, compile, optionally flash, and monitor a user-described firmware task."""

    steps: list[dict[str, Any]] = []
    gpio_validation = esp32_s3_validate_gpio(
        board_model=board_model,
        sda_pin=sda_pin,
        scl_pin=scl_pin,
        oled_clk_pin=oled_clk_pin,
        oled_mosi_pin=oled_mosi_pin,
        oled_reset_pin=oled_reset_pin,
        oled_dc_pin=oled_dc_pin,
        oled_protocol=oled_protocol,
        led_pin=led_pin,
        buzzer_pin=buzzer_pin,
    )
    steps.append({"name": "validate_gpio", "result": gpio_validation})
    if not gpio_validation["success"]:
        return _closed_loop_result(steps)

    generated = esp32_s3_generate_firmware_task_project(
        task=task,
        task_description=task_description,
        custom_code=custom_code,
        project_name=project_name,
        board_model=board_model,
        board=board,
        flash_size=flash_size,
        memory_type=memory_type,
        partitions=partitions,
        sda_pin=sda_pin,
        scl_pin=scl_pin,
        oled_clk_pin=oled_clk_pin,
        oled_mosi_pin=oled_mosi_pin,
        oled_reset_pin=oled_reset_pin,
        oled_dc_pin=oled_dc_pin,
        oled_protocol=oled_protocol,
        led_pin=led_pin,
        buzzer_pin=buzzer_pin,
        oled_text=oled_text,
    )
    steps.append({"name": "generate_firmware_task", "result": generated})
    if not generated["success"]:
        return _closed_loop_result(steps)

    project_dir = generated["project_dir"]
    compiled = esp32_s3_compile_project(project_dir, timeout_seconds=compile_timeout_sec)
    steps.append({"name": "compile", "result": compiled})
    if not compiled["success"]:
        return _closed_loop_result(steps)

    if port:
        flashed = esp32_s3_flash_project(project_dir, port=port, timeout_seconds=upload_timeout_sec)
        steps.append({"name": "flash", "result": flashed})
        if flashed["success"]:
            monitored = esp32_s3_monitor_serial(port=port, baud=115200, seconds=_clamp_float(monitor_seconds, 1.0, 120.0, 8.0))
            steps.append({"name": "monitor", "result": monitored})
            observation = esp32_task_observation_check(monitored.get("log", ""), str(task_description or ""))
            steps.append({"name": "task_observation_check", "result": observation})
    else:
        steps.append(
            {
                "name": "flash",
                "result": {
                    "success": None,
                    "summary": "Skipped because no serial port was provided.",
                    "next_step": "Provide the board COM port to flash and execute this firmware task on real hardware.",
                },
            }
        )
    result = _closed_loop_result(steps)
    result["firmware_task"] = {
        "task": generated.get("task"),
        "task_description": task_description,
        "custom_code": bool(custom_code),
    }
    return result


def _closed_loop_result(steps: list[dict[str, Any]]) -> dict[str, Any]:
    gpio_step = next((step for step in steps if step.get("name") == "validate_gpio"), None)
    if gpio_step and gpio_step.get("result", {}).get("success") is False:
        findings = [
            {
                "kind": item.get("kind", "gpio_configuration_invalid"),
                "severity": item.get("severity", "critical"),
                "evidence": f"{item.get('role', 'GPIO')} GPIO{item.get('gpio', '')}: {item.get('message', '')}",
                "action": "Adjust GPIO assignments before generating, flashing, or wiring hardware.",
            }
            for item in gpio_step.get("result", {}).get("findings", [])
        ]
        if not findings:
            findings = [
                {
                    "kind": "gpio_configuration_invalid",
                    "severity": "critical",
                    "evidence": gpio_step.get("result", {}).get("summary", "GPIO validation failed."),
                    "action": "Adjust GPIO assignments before generating, flashing, or wiring hardware.",
                }
            ]
        return {
            "success": False,
            "steps": steps,
            "diagnosis": {
                "success": True,
                "root_cause": "gpio_configuration_invalid",
                "confidence": 0.86,
                "findings": findings,
                "next_step": "Adjust GPIO assignments before generating, flashing, or wiring hardware.",
            },
            "summary": "Closed loop stopped at GPIO validation.",
        }

    all_logs = "\n".join(
        str(step.get("result", {}).get("log") or step.get("result", {}).get("summary") or step.get("result", {}).get("next_step") or "")
        for step in steps
    )
    diagnosis = esp32_s3_diagnose_log(all_logs)
    hard_fail = any(
        step.get("name") != "task_observation_check" and step.get("result", {}).get("success") is False
        for step in steps
    )
    return {
        "success": not hard_fail,
        "steps": steps,
        "diagnosis": diagnosis,
        "summary": "Closed loop completed." if not hard_fail else "Closed loop stopped at a failing step.",
    }


def _platformio_ini(
    board: str,
    platform: str = "espressif32",
    flash_size: str = DEFAULT_FLASH_SIZE,
    memory_type: str = DEFAULT_MEMORY_TYPE,
    partitions: str = DEFAULT_PARTITIONS,
    psram: bool = True,
    usb_cdc: bool = True,
    flash_mode: str = "",
) -> str:
    optional_lines = []
    if flash_mode:
        optional_lines.append(f"board_build.flash_mode = {flash_mode}")
    if memory_type:
        optional_lines.append(f"board_build.arduino.memory_type = {memory_type}")
    if partitions:
        optional_lines.append(f"board_build.partitions = {partitions}")
    build_flags = []
    if usb_cdc:
        build_flags.append("  -DARDUINO_USB_MODE=1")
        build_flags.append("  -DARDUINO_USB_CDC_ON_BOOT=1")
    if psram:
        build_flags.append("  -DBOARD_HAS_PSRAM")
    optional_block = "\n".join(optional_lines)
    build_flags_block = "\n".join(build_flags)
    build_flags_section = f"\nbuild_flags =\n{build_flags_block}\n" if build_flags else ""
    return f"""[env:{board}]
platform = {platform}
board = {board}
framework = arduino
monitor_speed = 115200
upload_speed = 921600
board_upload.flash_size = {flash_size}
{optional_block}
{build_flags_section}

lib_deps =
  adafruit/Adafruit AHTX0
  olikraus/U8g2
"""


def _normalize_board_model(value: str | None) -> str:
    text = str(value or DEFAULT_BOARD_MODEL).strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    aliases = {
        "n16r8": "esp32-s3-n16r8",
        "s3-n16r8": "esp32-s3-n16r8",
        "esp32s3-n16r8": "esp32-s3-n16r8",
        "esp32-s3-n16r8": "esp32-s3-n16r8",
        "n8r8": "esp32-s3-n8r8",
        "s3-n8r8": "esp32-s3-n8r8",
        "esp32s3-n8r8": "esp32-s3-n8r8",
        "esp32-s3-n8r8": "esp32-s3-n8r8",
        "n8": "esp32-s3-n8",
        "s3-n8": "esp32-s3-n8",
        "esp32s3-n8": "esp32-s3-n8",
        "esp32-s3-n8": "esp32-s3-n8",
        "esp32-s3-devkitc-1": "esp32-s3-devkitc-1",
        "devkitc-1": "esp32-s3-devkitc-1",
        "c3": "esp32-c3-devkitm-1",
        "esp32-c3": "esp32-c3-devkitm-1",
        "esp32c3": "esp32-c3-devkitm-1",
        "luatos-esp32c3-core": "luatos-esp32c3-core",
        "luatos-esp32-c3-core": "luatos-esp32c3-core",
        "luatos-esp32c3": "luatos-esp32c3-core",
        "hezhou-esp32c3": "luatos-esp32c3-core",
        "airm2m-esp32c3": "luatos-esp32c3-core",
        "esp32-c3-devkitm-1": "esp32-c3-devkitm-1",
        "c3-devkitm-1": "esp32-c3-devkitm-1",
        "devkitm-1": "esp32-c3-devkitm-1",
        "esp32-c3-devkitc-02": "esp32-c3-devkitc-02",
        "c3-devkitc-02": "esp32-c3-devkitc-02",
        "devkitc-02": "esp32-c3-devkitc-02",
        "esp32-devkit": "esp32-devkit-v1",
        "esp32-devkit-v1": "esp32-devkit-v1",
        "esp32-wroom-32": "esp32-devkit-v1",
        "esp32doit-devkit-v1": "esp32-devkit-v1",
        "esp32-wrover": "esp32-wrover",
        "esp-wrover-kit": "esp32-wrover",
        "esp8266": "esp8266-nodemcuv2",
        "esp8266-nodemcu": "esp8266-nodemcuv2",
        "esp8266-nodemcuv2": "esp8266-nodemcuv2",
        "nodemcu": "esp8266-nodemcuv2",
        "nodemcu-v2": "esp8266-nodemcuv2",
        "nodemcuv2": "esp8266-nodemcuv2",
        "esp-12e": "esp8266-esp12e",
        "esp12e": "esp8266-esp12e",
        "esp8266-esp12e": "esp8266-esp12e",
        "d1-mini": "esp8266-d1-mini",
        "wemos-d1-mini": "esp8266-d1-mini",
        "esp8266-d1-mini": "esp8266-d1-mini",
    }
    if normalized in aliases:
        return aliases[normalized]
    if "n16r8" in normalized:
        return "esp32-s3-n16r8"
    if "n8r8" in normalized:
        return "esp32-s3-n8r8"
    if "s3" in normalized and re.search(r"(^|-)n8($|-)", normalized):
        return "esp32-s3-n8"
    if "c3" in normalized and "devkitc" in normalized:
        return "esp32-c3-devkitc-02"
    if "luatos" in normalized and "c3" in normalized:
        return "luatos-esp32c3-core"
    if ("hezhou" in normalized or "airm2m" in normalized) and "c3" in normalized:
        return "luatos-esp32c3-core"
    if "c3" in normalized:
        return "esp32-c3-devkitm-1"
    if "wrover" in normalized:
        return "esp32-wrover"
    if "8266" in normalized and ("d1" in normalized or "wemos" in normalized):
        return "esp8266-d1-mini"
    if "8266" in normalized and ("esp12" in normalized or "esp-12" in normalized):
        return "esp8266-esp12e"
    if "8266" in normalized or "nodemcu" in normalized:
        return "esp8266-nodemcuv2"
    if "d1" in normalized and "mini" in normalized:
        return "esp8266-d1-mini"
    if "wroom" in normalized or ("esp32" in normalized and "s3" not in normalized):
        return "esp32-devkit-v1"
    return normalized if normalized in BOARD_PRESETS else DEFAULT_BOARD_MODEL


def _normalize_firmware_task(task: str | None) -> str:
    value = re.sub(r"[^a-z0-9_]+", "_", str(task or "custom").strip().lower()).strip("_")
    return value if value in FIRMWARE_TASKS else "custom"


def _infer_firmware_task(description: str) -> str:
    text = str(description or "").lower()
    if any(word in text for word in ["生日快乐", "happy birthday", "birthday"]):
        return "buzzer_happy_birthday"
    if any(word in text for word in ["蜂鸣器", "buzzer", "播放", "旋律"]):
        return "buzzer_happy_birthday"
    if any(word in text for word in ["温度", "湿度", "温湿度", "aht20", "temperature", "humidity"]):
        return "aht20_read"
    if any(word in text for word in ["oled", "显示屏", "屏幕", "显示"]):
        return "oled_message"
    if any(word in text for word in ["闪烁", "blink"]):
        return "led_blink"
    if any(word in text for word in ["关闭", "熄灭", "off"]):
        return "led_off"
    if any(word in text for word in ["点亮", "打开", "led", "on"]):
        return "led_on"
    return "custom"


def _validate_custom_firmware_code(code: str) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    if "#include <Arduino.h>" not in code:
        findings.append({"kind": "missing_arduino_include", "severity": "critical", "message": "custom_code must include Arduino.h"})
    if not re.search(r"\bvoid\s+setup\s*\(", code):
        findings.append({"kind": "missing_setup", "severity": "critical", "message": "custom_code must define void setup()"})
    if not re.search(r"\bvoid\s+loop\s*\(", code):
        findings.append({"kind": "missing_loop", "severity": "critical", "message": "custom_code must define void loop()"})
    if "Serial.begin" not in code or "[BOOT]" not in code:
        findings.append({"kind": "missing_boot_log", "severity": "warning", "message": "custom_code should initialize Serial and print a [BOOT] marker"})
    forbidden = ["system(", "popen(", "fork(", "exec(", "WiFiClientSecure", "HTTPClient"]
    for token in forbidden:
        if token in code:
            findings.append({"kind": "forbidden_api", "severity": "critical", "message": f"custom_code contains forbidden token: {token}"})
    critical = [item for item in findings if item["severity"] == "critical"]
    return {
        "success": not critical,
        "summary": "Custom firmware code accepted." if not critical else "Custom firmware code failed safety validation.",
        "findings": findings,
    }


def _cpp_string(value: str) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def _preview_source(code: str, limit: int = 12) -> list[str]:
    lines = [line.rstrip() for line in str(code or "").splitlines()[:limit]]
    return lines


def _oled_safe_text(value: str) -> str:
    """Fallback text for legacy Adafruit custom OLED code that cannot render Chinese."""
    text = str(value or "")
    text = re.sub(r"[^\x20-\x7E]", " ", text)
    if re.fullmatch(r"[\s?]+", text):
        text = "ESP Agent"
    text = re.sub(r"\s+", " ", text).strip()
    return (text or "ESP Agent")[:64]


def _sanitize_custom_oled_literals(code: str) -> tuple[str, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []

    def replace_literal(match: re.Match[str]) -> str:
        prefix = match.group(1)
        quote = match.group(2)
        raw = match.group(3)
        suffix = match.group(4)
        if all(ord(ch) < 128 for ch in raw):
            return match.group(0)
        safe = _oled_safe_text(raw)
        findings.append(
            {
                "kind": "oled_text_ascii_normalized",
                "severity": "info",
                "message": f'OLED display text "{raw}" was normalized to "{safe}" because the default SSD1306 font is ASCII-only.',
            }
        )
        return f"{prefix}{quote}{safe}{quote}{suffix}"

    pattern = re.compile(r"(\bdisplay\.(?:print|println)\s*\(\s*)([\"'])(.*?)(\2\s*\))", re.DOTALL)
    return pattern.sub(replace_literal, code), findings


def _agent_peripherals_h() -> str:
    return """#pragma once

#include <Arduino.h>

bool agentInit();
void agentHeartbeat();

bool i2cInit();
bool oledInit();
void oledShowChinese(const char* line1, const char* line2 = "", const char* line3 = "");

bool ledInit();
void ledSet(bool on);
void ledBlink(int periodMs, int count);

bool buzzerInit();
void buzzerBeep(int frequency, int durationMs);
void buzzerHappyBirthday();

bool aht20Init();
bool aht20Read(float* temperature, float* humidity);
"""


def _resolve_oled_protocol(value: str, oled_dc_pin: int = -1) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "", str(value or "auto").strip().lower())
    if normalized in {"spi", "softspi", "swspi", "4wirespi", "4wire"}:
        return "spi"
    if normalized in {"i2c", "iic", "wire", "twowire"}:
        return "i2c"
    return "spi" if int(oled_dc_pin) >= 0 else "i2c"


def _agent_peripherals_cpp(
    sda_pin: int,
    scl_pin: int,
    oled_clk_pin: int,
    oled_mosi_pin: int,
    oled_reset_pin: int,
    oled_dc_pin: int,
    oled_protocol: str,
    led_pin: int,
    buzzer_pin: int,
) -> str:
    resolved_oled_protocol = _resolve_oled_protocol(oled_protocol, oled_dc_pin)
    resolved_oled_clk_pin = int(oled_clk_pin) if int(oled_clk_pin) >= 0 else (-1 if resolved_oled_protocol == "spi" else int(scl_pin))
    resolved_oled_mosi_pin = int(oled_mosi_pin) if int(oled_mosi_pin) >= 0 else (-1 if resolved_oled_protocol == "spi" else int(sda_pin))
    oled_declaration = (
        "U8G2_SSD1306_128X64_NONAME_F_4W_SW_SPI oled(\n"
        "  U8G2_R0,\n"
        "  OLED_CLK_PIN,\n"
        "  OLED_MOSI_PIN,\n"
        "  U8X8_PIN_NONE,\n"
        "  OLED_DC_PIN >= 0 ? OLED_DC_PIN : U8X8_PIN_NONE,\n"
        "  OLED_RESET_PIN >= 0 ? OLED_RESET_PIN : U8X8_PIN_NONE\n"
        ");"
        if resolved_oled_protocol == "spi"
        else
        "U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(\n"
        "  U8G2_R0,\n"
        "  OLED_RESET_PIN >= 0 ? OLED_RESET_PIN : U8X8_PIN_NONE,\n"
        "  I2C_SCL_PIN,\n"
        "  I2C_SDA_PIN\n"
        ");"
    )
    oled_init_address = "  oled.setI2CAddress(OLED_ADDR << 1);\n" if resolved_oled_protocol == "i2c" else ""
    oled_init_log = (
        '  Serial.println("[OLED] init ok protocol=SPI driver=SSD1306_128x64 clk=OLED_CLK data=OLED_MOSI cs=none font=wqy12_gb2312 utf8=on");'
        if resolved_oled_protocol == "spi"
        else
        '  Serial.println("[OLED] init ok protocol=I2C driver=SSD1306_128x64 address=0x3C font=wqy12_gb2312 utf8=on");'
    )
    return f"""#include "agent_peripherals.h"

#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <U8g2lib.h>

namespace {{
constexpr int I2C_SDA_PIN = {sda_pin};
constexpr int I2C_SCL_PIN = {scl_pin};
constexpr int OLED_CLK_PIN = {resolved_oled_clk_pin};
constexpr int OLED_MOSI_PIN = {resolved_oled_mosi_pin};
constexpr int OLED_RESET_PIN = {oled_reset_pin};
constexpr int OLED_DC_PIN = {oled_dc_pin};
constexpr const char* OLED_PROTOCOL = "{resolved_oled_protocol}";
constexpr int LED_PIN = {led_pin};
constexpr int BUZZER_PIN = {buzzer_pin};
constexpr uint8_t OLED_ADDR = 0x3C;
constexpr bool HAS_I2C = I2C_SDA_PIN >= 0 && I2C_SCL_PIN >= 0;

Adafruit_AHTX0 aht;
{oled_declaration}

bool ahtReady = false;
bool oledReady = false;
bool i2cReady = false;
bool ledReady = false;
bool buzzerReady = false;
unsigned long lastHeartbeatMs = 0;
uint32_t heartbeatCount = 0;

void logPins() {{
  Serial.printf("[PIN] SDA=%d SCL=%d OLED_RES=%d OLED_DC=%d LED=%d BUZZER=%d\\n",
                I2C_SDA_PIN, I2C_SCL_PIN, OLED_RESET_PIN, OLED_DC_PIN, LED_PIN, BUZZER_PIN);
  Serial.printf("[PIN] OLED_CLK=%d OLED_MOSI=%d\\n", OLED_CLK_PIN, OLED_MOSI_PIN);
  Serial.printf("[OLED] protocol=%s note=%s\\n",
                OLED_PROTOCOL,
                strcmp(OLED_PROTOCOL, "spi") == 0 ? "OLED_CLK=CLK OLED_MOSI=MOSI RES=RST DC=DC CS=none" : "SCL=SCL SDA=SDA address=0x3C");
}}
}}  // namespace

bool agentInit() {{
  Serial.println("[AGENT] core init");
  logPins();
  Serial.println("[AGENT] core init done; peripherals use lazy init");
  return true;
}}

bool i2cInit() {{
  if (i2cReady) {{
    return true;
  }}
  if (HAS_I2C) {{
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    Wire.setClock(100000);
    i2cReady = true;
    Serial.println("[I2C] enabled");
    return true;
  }} else {{
    Serial.println("[I2C] disabled");
    return false;
  }}
}}

bool ledInit() {{
  if (LED_PIN >= 0) {{
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
    ledReady = true;
    Serial.printf("[LED] ready pin=%d active_high=1\\n", LED_PIN);
    return true;
  }} else {{
    Serial.println("[LED] disabled");
    ledReady = false;
    return false;
  }}
}}

bool buzzerInit() {{
  if (BUZZER_PIN >= 0) {{
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    buzzerReady = true;
    Serial.printf("[BUZZER] ready pin=%d\\n", BUZZER_PIN);
    return true;
  }} else {{
    Serial.println("[BUZZER] disabled");
    buzzerReady = false;
    return false;
  }}
}}

void agentHeartbeat() {{
  const unsigned long now = millis();
  if (now - lastHeartbeatMs >= 1000) {{
    lastHeartbeatMs = now;
    heartbeatCount++;
    Serial.printf("[HEARTBEAT] count=%lu oled=%s aht20=%s\\n",
                  static_cast<unsigned long>(heartbeatCount),
                  oledReady ? "ready" : "not_ready",
                  ahtReady ? "ready" : "not_ready");
  }}
}}

bool oledInit() {{
  if (oledReady) {{
    return true;
  }}
{oled_init_address}  if (strcmp(OLED_PROTOCOL, "spi") == 0 && OLED_DC_PIN < 0) {{
    Serial.println("[OLED] init failed protocol=SPI reason=OLED_DC_PIN is required");
    oledReady = false;
    return false;
  }}
  if (strcmp(OLED_PROTOCOL, "spi") == 0 && (OLED_CLK_PIN < 0 || OLED_MOSI_PIN < 0)) {{
    Serial.println("[OLED] init failed protocol=SPI reason=OLED_CLK_PIN and OLED_MOSI_PIN are required");
    oledReady = false;
    return false;
  }}
  if (strcmp(OLED_PROTOCOL, "i2c") == 0 && !HAS_I2C) {{
    Serial.println("[OLED] init failed protocol=I2C reason=I2C pins disabled");
    oledReady = false;
    return false;
  }}
  if (strcmp(OLED_PROTOCOL, "i2c") == 0 && !i2cInit()) {{
    Serial.println("[OLED] init failed protocol=I2C reason=I2C init failed");
    oledReady = false;
    return false;
  }}
  oled.begin();
  oled.enableUTF8Print();
  oledReady = true;
{oled_init_log}
  return oledReady;
}}

void oledShowChinese(const char* line1, const char* line2, const char* line3) {{
  if (!oledReady) {{
    oledInit();
  }}
  if (!oledReady) {{
    Serial.printf("[OLED] skipped not_ready line1=%s\\n", line1 ? line1 : "");
    return;
  }}

  oled.clearBuffer();
  oled.setFont(u8g2_font_wqy12_t_gb2312);
  oled.drawUTF8(0, 12, line1 ? line1 : "");
  oled.drawUTF8(0, 30, line2 ? line2 : "");
  oled.drawUTF8(0, 48, line3 ? line3 : "");
  oled.sendBuffer();
  Serial.printf("[OLED] update line1=%s line2=%s line3=%s\\n",
                line1 ? line1 : "", line2 ? line2 : "", line3 ? line3 : "");
}}

void ledSet(bool on) {{
  if (!ledReady && !ledInit()) {{
    Serial.println("[LED] set skipped disabled");
    return;
  }}
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  Serial.printf("[LED] state=%s pin=%d\\n", on ? "ON" : "OFF", LED_PIN);
}}

void ledBlink(int periodMs, int count) {{
  if (!ledReady && !ledInit()) {{
    Serial.println("[LED] blink skipped disabled");
    return;
  }}
  const int safePeriod = max(20, periodMs);
  const int safeCount = max(1, count);
  Serial.printf("[LED] blink start period_ms=%d count=%d\\n", safePeriod, safeCount);
  for (int i = 0; i < safeCount; i++) {{
    ledSet(true);
    delay(safePeriod / 2);
    ledSet(false);
    delay(safePeriod / 2);
  }}
  Serial.println("[LED] blink done");
}}

void buzzerBeep(int frequency, int durationMs) {{
  if (!buzzerReady && !buzzerInit()) {{
    Serial.println("[BUZZER] beep skipped disabled");
    return;
  }}
  const int safeFrequency = max(20, frequency);
  const int safeDuration = max(10, durationMs);
  Serial.printf("[BUZZER] beep frequency=%d duration_ms=%d\\n", safeFrequency, safeDuration);
  tone(BUZZER_PIN, safeFrequency, safeDuration);
  delay(safeDuration + 20);
  noTone(BUZZER_PIN);
}}

void buzzerHappyBirthday() {{
  const int melody[] = {{262, 262, 294, 262, 349, 330, 262, 262, 294, 262, 392, 349, 262, 262, 523, 440, 349, 330, 294, 466, 466, 440, 349, 392, 349}};
  const int duration[] = {{220, 220, 430, 430, 430, 760, 220, 220, 430, 430, 430, 760, 220, 220, 430, 430, 430, 430, 760, 220, 220, 430, 430, 430, 760}};
  Serial.println("[BUZZER] happy_birthday start");
  for (size_t i = 0; i < sizeof(melody) / sizeof(melody[0]); i++) {{
    buzzerBeep(melody[i], duration[i]);
    delay(35);
  }}
  Serial.println("[BUZZER] happy_birthday done");
}}

bool aht20Init() {{
  if (ahtReady) {{
    return true;
  }}
  if (!HAS_I2C) {{
    ahtReady = false;
    Serial.println("[AHT20] disabled reason=I2C pins disabled");
    return false;
  }}
  if (!i2cInit()) {{
    ahtReady = false;
    Serial.println("[AHT20] init failed reason=I2C init failed");
    return false;
  }}
  ahtReady = aht.begin(&Wire);
  Serial.println(ahtReady ? "[AHT20] init ok address=0x38" : "[AHT20] init failed address=0x38");
  return ahtReady;
}}

bool aht20Read(float* temperature, float* humidity) {{
  if (!ahtReady) {{
    aht20Init();
  }}
  if (!ahtReady) {{
    Serial.println("[AHT20] read failed not_ready");
    return false;
  }}

  sensors_event_t humiEvent;
  sensors_event_t tempEvent;
  aht.getEvent(&humiEvent, &tempEvent);
  if (temperature) *temperature = tempEvent.temperature;
  if (humidity) *humidity = humiEvent.relative_humidity;
  Serial.printf("[AHT20] temperature=%.2fC humidity=%.2f%%\\n", tempEvent.temperature, humiEvent.relative_humidity);
  return true;
}}
"""


def _model_owned_main_cpp(task: str, oled_text: str) -> str:
    task = _normalize_firmware_task(task)
    text = str(oled_text or "Embex")[:64]
    escaped_text = _cpp_string(text)
    setup_action = {
        "led_on": "ledSet(true);",
        "led_off": "ledSet(false);",
        "led_blink": "ledBlink(1000, 6);",
        "aht20_read": "readAndDisplayAht20();",
        "oled_message": f"oledShowChinese({escaped_text}, \"系统正常\", \"Embex\");",
        "buzzer_happy_birthday": "buzzerHappyBirthday();",
        "custom": f"Serial.println(\"[APP] fallback custom task: {text}\");",
    }[task]
    loop_action = {
        "led_blink": "ledBlink(1000, 1);",
        "aht20_read": "readAndDisplayAht20(); delay(2000);",
    }.get(task, "agentHeartbeat(); delay(100);")

    return f"""#include <Arduino.h>
#include "agent_peripherals.h"

constexpr const char* TASK_NAME = "{task}";

void readAndDisplayAht20() {{
  float temperature = 0.0f;
  float humidity = 0.0f;
  if (!aht20Read(&temperature, &humidity)) {{
    oledShowChinese("AHT20读取失败", "检查SDA/SCL", "地址0x38");
    return;
  }}

  char line1[32];
  char line2[32];
  snprintf(line1, sizeof(line1), "Temp %.2f C", temperature);
  snprintf(line2, sizeof(line2), "Humi %.2f %%", humidity);
  oledShowChinese(line1, line2, "AHT20 OK");
}}

void setup() {{
  Serial.begin(115200);
  delay(800);
  Serial.println("[BOOT] Embex model-owned main.cpp start");
  Serial.printf("[TASK] name=%s\\n", TASK_NAME);

  agentInit();
  {setup_action}

  Serial.println("[APP] setup done");
}}

void loop() {{
  {loop_action}
}}
"""


def _firmware_task_cpp(
    task: str,
    sda_pin: int,
    scl_pin: int,
    oled_reset_pin: int,
    oled_dc_pin: int,
    led_pin: int,
    buzzer_pin: int,
    oled_text: str,
) -> str:
    task = _normalize_firmware_task(task)
    oled_line = _cpp_string(str(oled_text or "你好 ESP Agent")[:64])
    setup_action = {
        "led_on": "setLed(true, \"task_led_on\");",
        "led_off": "setLed(false, \"task_led_off\");",
        "led_blink": "Serial.println(\"[TASK] led_blink active\");",
        "aht20_read": "readAht20Once();",
        "oled_message": f"drawStatus(\"OLED message\", {oled_line}, \"task done\");",
        "buzzer_happy_birthday": "playHappyBirthday();",
        "custom": "Serial.println(\"[TASK] custom fallback idle\");",
    }[task]
    loop_action = {
        "led_blink": "static bool on = false; on = !on; setLed(on, \"task_led_blink\"); delay(500);",
        "aht20_read": "readAht20Once(); delay(2000);",
    }.get(task, "Serial.println(\"[SYSTEM] task idle\"); delay(2000);")

    return f"""#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <U8g2lib.h>

constexpr int I2C_SDA_PIN = {sda_pin};
constexpr int I2C_SCL_PIN = {scl_pin};
constexpr int OLED_RESET_PIN = {oled_reset_pin};
constexpr int OLED_DC_PIN = {oled_dc_pin};
constexpr int LED_PIN = {led_pin};
constexpr int BUZZER_PIN = {buzzer_pin};
constexpr int OLED_WIDTH = 128;
constexpr int OLED_HEIGHT = 64;
constexpr uint8_t OLED_ADDR = 0x3C;
constexpr const char* TASK_NAME = "{task}";

Adafruit_AHTX0 aht;
U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, OLED_RESET_PIN >= 0 ? OLED_RESET_PIN : U8X8_PIN_NONE, I2C_SCL_PIN, I2C_SDA_PIN);
bool ahtReady = false;
bool oledReady = false;

void setLed(bool on, const char* reason) {{
  if (LED_PIN < 0) {{
    Serial.printf("[LED] disabled reason=%s\\n", reason);
    return;
  }}
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  Serial.printf("[LED] state=%s reason=%s\\n", on ? "ON" : "OFF", reason);
}}

void beep(int frequency, int durationMs, const char* reason) {{
  if (BUZZER_PIN < 0) {{
    Serial.printf("[BUZZER] disabled reason=%s\\n", reason);
    return;
  }}
  Serial.printf("[BUZZER] tone frequency=%d duration_ms=%d reason=%s\\n", frequency, durationMs, reason);
  tone(BUZZER_PIN, frequency, durationMs);
  delay(durationMs + 20);
  noTone(BUZZER_PIN);
}}

void playHappyBirthday() {{
  const int melody[] = {{262, 262, 294, 262, 349, 330, 262, 262, 294, 262, 392, 349, 262, 262, 523, 440, 349, 330, 294, 466, 466, 440, 349, 392, 349}};
  const int duration[] = {{250, 250, 500, 500, 500, 900, 250, 250, 500, 500, 500, 900, 250, 250, 500, 500, 500, 500, 900, 250, 250, 500, 500, 500, 900}};
  Serial.println("[BUZZER] melody=happy_birthday start");
  for (size_t i = 0; i < sizeof(melody) / sizeof(melody[0]); i++) {{
    beep(melody[i], duration[i], "happy_birthday");
    delay(40);
  }}
  Serial.println("[BUZZER] melody=happy_birthday done");
}}

void drawStatus(const char* line1, const char* line2, const char* line3) {{
  if (!oledReady) {{
    Serial.printf("[OLED] display skipped line1=%s\\n", line1);
    return;
  }}
  display.clearBuffer();
  display.setFont(u8g2_font_wqy12_t_gb2312);
  display.drawUTF8(0, 12, "ESP智能体");
  display.drawUTF8(0, 28, line1);
  display.drawUTF8(0, 44, line2);
  display.drawUTF8(0, 60, line3);
  display.sendBuffer();
  Serial.printf("[OLED] display update line1=%s line2=%s line3=%s\\n", line1, line2, line3);
}}

void readAht20Once() {{
  if (!ahtReady) {{
    Serial.println("[ERROR] AHT20 read skipped because init failed");
    return;
  }}
  sensors_event_t humidity;
  sensors_event_t temp;
  aht.getEvent(&humidity, &temp);
  Serial.printf("[DATA] temp=%.2fC humidity=%.2f%%\\n", temp.temperature, humidity.relative_humidity);
  char line1[32];
  char line2[32];
  snprintf(line1, sizeof(line1), "Temp: %.2f C", temp.temperature);
  snprintf(line2, sizeof(line2), "Humi: %.2f %%", humidity.relative_humidity);
  drawStatus(line1, line2, "AHT20 OK");
}}

void setup() {{
  Serial.begin(115200);
  delay(1200);
  Serial.println("[BOOT] ESP32-S3-N16R8 firmware task start");
  Serial.printf("[TASK] name=%s\\n", TASK_NAME);
  Serial.printf("[PIN] SDA=%d SCL=%d LED=%d BUZZER=%d OLED_RES=%d OLED_DC=%d\\n", I2C_SDA_PIN, I2C_SCL_PIN, LED_PIN, BUZZER_PIN, OLED_RESET_PIN, OLED_DC_PIN);

  if (LED_PIN >= 0) {{
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
    Serial.printf("[LED] ready pin=%d\\n", LED_PIN);
  }}
  if (BUZZER_PIN >= 0) {{
    pinMode(BUZZER_PIN, OUTPUT);
    Serial.printf("[BUZZER] ready pin=%d\\n", BUZZER_PIN);
  }}

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  display.setI2CAddress(OLED_ADDR << 1);
  display.begin();
  display.enableUTF8Print();
  oledReady = true;
  Serial.println("[OLED] init ok address=0x3C font=wqy12_gb2312 utf8=on");
  ahtReady = aht.begin(&Wire);
  Serial.println(ahtReady ? "[AHT20] init ok address=0x38" : "[ERROR] AHT20 not found at 0x38");

  {setup_action}
  Serial.println("[SYSTEM] setup complete");
}}

void loop() {{
  {loop_action}
}}
"""


def _main_cpp(
    sda_pin: int,
    scl_pin: int,
    oled_reset_pin: int,
    oled_dc_pin: int,
    led_pin: int,
    buzzer_pin: int,
) -> str:
    return f"""#include <Arduino.h>

constexpr int I2C_SDA_PIN = {sda_pin};
constexpr int I2C_SCL_PIN = {scl_pin};
constexpr int OLED_RESET_PIN = {oled_reset_pin};
constexpr int OLED_DC_PIN = {oled_dc_pin};
constexpr int LED_PIN = {led_pin};
constexpr int BUZZER_PIN = {buzzer_pin};

void setup() {{
  Serial.begin(115200);
  delay(500);
  Serial.println("[BOOT] Embex neutral ESP project start");
  Serial.printf("[PIN] SDA=%d SCL=%d LED=%d BUZZER=%d OLED_RES=%d OLED_DC=%d\\n",
                I2C_SDA_PIN, I2C_SCL_PIN, LED_PIN, BUZZER_PIN, OLED_RESET_PIN, OLED_DC_PIN);
  Serial.println("[APP] No fixed peripheral app is embedded. Generate a task-specific main.cpp for hardware control.");
  Serial.println("[SYSTEM] setup complete");
}}

void loop() {{
  Serial.println("[HEARTBEAT] Embex neutral firmware running");
  delay(2000);
}}
"""

def _first_matching_line(text: str, needle: str) -> str:
    low_needle = needle.lower()
    for line in str(text or "").splitlines():
        if low_needle in line.lower():
            return line.strip()
    return ""


def _has_line_with(text: str, subject: str, markers: tuple[str, ...]) -> bool:
    return bool(_first_line_with(text, subject, markers))


def _first_line_with(text: str, subject: str, markers: tuple[str, ...]) -> str:
    subject_lower = subject.lower()
    for line in str(text or "").splitlines():
        line_lower = line.lower()
        if subject_lower in line_lower and any(marker in line_lower for marker in markers):
            return line.strip()
    return ""


def _observation_item(
    key: str,
    label: str,
    passed: bool,
    evidence_required: str,
    action: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "passed": bool(passed),
        "evidence_required": evidence_required,
        "action": action,
    }


def _summarize_log(log: str) -> str:
    for key in ["fatal error", "error:", "Failed", "could not open port", "timed out"]:
        line = _first_matching_line(log, key)
        if line:
            return line
    return "Command failed. Inspect raw log."


def _choose_root_cause(findings: list[dict[str, Any]]) -> str:
    priority = [
        "toolchain_missing",
        "missing_header_or_library",
        "compile_error",
        "upload_connect_failed",
        "platformio_dependency_timeout",
        "serial_port_unavailable",
        "power_brownout",
        "esp32_panic",
        "aht20_i2c_fault",
        "oled_i2c_fault",
        "no_serial_output",
        "build_ok",
        "runtime_ok",
    ]
    by_kind = {item["kind"]: item for item in findings}
    for kind in priority:
        if kind in by_kind:
            return by_kind[kind]["kind"]
    return findings[0]["kind"] if findings else "unknown"


def _confidence(findings: list[dict[str, Any]]) -> float:
    severities = {item.get("severity") for item in findings}
    if "critical" in severities:
        return 0.86
    if "warning" in severities:
        return 0.74
    if any(item.get("kind") == "runtime_ok" for item in findings):
        return 0.9
    return 0.45


esp_resolve_board = esp32_s3_resolve_board
esp_generate_project = esp32_s3_generate_project
esp_generate_firmware_task_project = esp32_s3_generate_firmware_task_project
esp_validate_gpio = esp32_s3_validate_gpio
esp_compile_project = esp32_s3_compile_project
esp_flash_project = esp32_s3_flash_project
esp_monitor_serial = esp32_s3_monitor_serial
esp_list_serial_ports = esp32_s3_list_serial_ports
esp_preflight = esp32_s3_preflight
esp_diagnose_log = esp32_s3_diagnose_log
esp_run_closed_loop = esp32_s3_run_closed_loop
esp_run_firmware_task = esp32_s3_run_firmware_task
esp_task_observation_check = esp32_task_observation_check


TOOLS_MAP = {
    "esp_resolve_board": esp_resolve_board,
    "esp_generate_project": esp_generate_project,
    "esp_generate_firmware_task_project": esp_generate_firmware_task_project,
    "esp_validate_gpio": esp_validate_gpio,
    "esp_compile_project": esp_compile_project,
    "esp_flash_project": esp_flash_project,
    "esp_monitor_serial": esp_monitor_serial,
    "esp_list_serial_ports": esp_list_serial_ports,
    "esp_preflight": esp_preflight,
    "esp_diagnose_log": esp_diagnose_log,
    "esp_run_closed_loop": esp_run_closed_loop,
    "esp_run_firmware_task": esp_run_firmware_task,
    "esp_task_observation_check": esp_task_observation_check,
}
