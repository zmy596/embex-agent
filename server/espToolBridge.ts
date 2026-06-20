import {
  checkEspTaskObservation as checkEspTaskObservationFromPython,
  checkEspEnvironment as checkEspEnvironmentFromPython,
  diagnoseEspLog as diagnoseEspLogFromPython,
  compileAndFlashGeneratedFirmware as compileAndFlashGeneratedFirmwareFromPython,
  listEspSerialPorts as listEspSerialPortsFromPython,
  listMergedSerialPorts as listMergedEspSerialPortsFromPython,
  probeEspSerialPort as probeEspSerialPortFromPython,
  runEspClosedLoop as runEspClosedLoopFromPython,
  runEspPreflight as runEspPreflightFromPython,
  type ClosedLoopRequest,
  type FirmwareTaskRequest
} from "./espPythonBridge.js";

export type EspClosedLoopRequest = ClosedLoopRequest;
export type EspFirmwareTaskRequest = FirmwareTaskRequest;

export function runEspClosedLoop(payload: EspClosedLoopRequest, signal?: AbortSignal): Promise<unknown> {
  return runEspClosedLoopFromPython(payload, signal);
}

export function compileAndFlashGeneratedFirmware(payload: EspFirmwareTaskRequest, signal?: AbortSignal): Promise<unknown> {
  return compileAndFlashGeneratedFirmwareFromPython(payload, signal);
}

export function checkEspEnvironment(): Promise<unknown> {
  return checkEspEnvironmentFromPython();
}

export function listEspSerialPorts(): Promise<unknown> {
  return listEspSerialPortsFromPython();
}

export function listMergedEspSerialPorts(): Promise<unknown> {
  return listMergedEspSerialPortsFromPython();
}

export function diagnoseEspLog(log: string): Promise<unknown> {
  return diagnoseEspLogFromPython(log);
}

export function checkEspTaskObservation(log: string, taskDescription = ""): Promise<unknown> {
  return checkEspTaskObservationFromPython(log, taskDescription);
}

export function runEspPreflight(): Promise<unknown> {
  return runEspPreflightFromPython();
}

export function probeEspSerialPort(port: string, baud = 115200): Promise<unknown> {
  return probeEspSerialPortFromPython(port, baud);
}
