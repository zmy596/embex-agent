# Security Policy

## Secrets

Never commit:

- `.env`
- model API keys
- provider tokens
- private serial logs
- local credentials

Use `.env.example` for documentation only.

## Hardware Safety

Embex can compile and upload firmware to local ESP boards. Review generated code and hardware wiring before running upload tasks on important hardware.

Recommended precautions:

- verify board model and serial port,
- avoid boot/strapping/USB pins unless intentionally used,
- check VCC and GND,
- disconnect unknown peripherals before flashing,
- keep firmware tasks scoped to the intended board.

## Reporting Issues

For public GitHub repositories, report security-sensitive issues privately if possible. If private reporting is not enabled, open a minimal issue without secrets or exploit details and ask for a private contact channel.

