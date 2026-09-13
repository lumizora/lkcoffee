export const PROTOCOL_VERSION = 1;

export type AudioCommandType =
  | "hello"
  | "get_permission"
  | "request_permission"
  | "get_devices"
  | "get_default_device"
  | "select_device"
  | "start"
  | "stop"
  | "shutdown";

export type AudioPermissionStatus = "unknown" | "not_determined" | "granted" | "denied" | "restricted";
export type AudioStatus = "uninitialized" | "ready" | "capturing" | "error" | "shutdown";
export type AudioErrorCode = "PERMISSION_DENIED" | "DEVICE_NOT_FOUND" | "INVALID_STATE" | "IPC_FAILED" | "PROTOCOL_ERROR" | "HELPER_CRASHED" | "INTERNAL_ERROR";

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
  sampleRate?: number;
  channels?: number;
  transport?: string;
}

export interface AudioError {
  code: AudioErrorCode;
  message: string;
  recoverable: boolean;
}

export interface AudioCommand {
  id: string;
  type: AudioCommandType;
  payload?: unknown;
}

export interface AudioResponse {
  id: string;
  type: "response";
  success: boolean;
  payload?: unknown;
  error?: AudioError;
}

export interface AudioEvent {
  type: "ready" | "capture_started" | "capture_stopped" | "error";
  protocolVersion?: number;
  payload?: unknown;
  error?: AudioError;
}
