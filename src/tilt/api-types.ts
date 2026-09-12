// Tilt API Types - TypeScript translation from Tilt API responses
// These types represent the raw data structures from the Tilt API

export const API_BUTTON_ANNOTATION_TYPE = "tilt.dev/uibutton-type";
export const API_BUTTON_TOGGLE_DISABLE_TYPE = "DisableToggle";

export interface APIResourceMetadata {
  annotations: Record<string, string>;
  creationTimestamp: string;
  labels: Record<string, string>;
  name: string;
  resourceVersion: string;
  uid: string;
}

export interface APIResource {
  apiVersion: string;
  kind: string;
  metadata: APIResourceMetadata;
  spec: Record<string, unknown>;
  status: APIResourceStatus;
}

export interface APIBuild {
  startTime?: string;
  finishTime?: string;
  error?: string;
  warnings?: string[];
  edits?: string[];
  reason?: string;
  spanID?: string;
}

export interface APIStatusSpec {
  id: string;
  type: string; // "local" | "k8s" | "image"
}

export interface APIStatusCondition {
  lastTransitionTime: string;
  reason: string;
  status: string; // "True" | "False" | "Unknown"
  type: string; // "UpToDate" | "Ready"
}

export interface APIDisableStatus {
  disabledCount: number;
  enabledCount: number;
  sources: unknown;
  state: unknown;
}

export interface APIK8sResourceStatusInfo {
  allContainersReady: boolean;
  displayNames: string[];
  podCreationTime: string;
  podName: string;
  podRestarts: number;
  podStatus: string;
  podUpdateStartTime?: string;
  spanID: string;
}

export interface APILocalResourceInfo {
  pid?: string;
}

export interface APIEndpointLink {
  url: string;
  name?: string;
}

// what is the status of the resource in the cluster
// Copied from pkg/model
export enum RuntimeStatus {
  Ok = "ok",
  Pending = "pending",
  Error = "error",
  NotApplicable = "not_applicable",
  None = "none",
}

// what is the status of the update
// Copied from pkg/model
export enum UpdateStatus {
  Ok = "ok",
  Pending = "pending",
  InProgress = "in_progress",
  Error = "error",
  NotApplicable = "not_applicable",
  None = "none",
}

export interface APIResourceStatus {
  // Common fields
  order: number;
  conditions: APIStatusCondition[];
  disableStatus: APIDisableStatus;
  pendingBuildSince?: string;
  runtimeStatus?: RuntimeStatus;
  updateStatus?: UpdateStatus;

  // Build-related fields
  buildHistory?: APIBuild[];
  lastDeployTime?: string;

  // Endpoint links
  endpointLinks?: APIEndpointLink[];

  // K8s-specific fields
  k8sResourceInfo?: APIK8sResourceStatusInfo;
  specs?: APIStatusSpec[];

  // Local-specific fields
  localResourceInfo?: APILocalResourceInfo;
  triggerMode?: number;
}

export interface APILogSegment {
  time: string;
  text: string;
  level: string;
  spanId?: string;
  fields?: Record<"buildEvent" | "progressID", string>;
  anchor?: boolean;
}

export interface APISpan {
  manifestName?: string;
}

export interface APILogList {
  segments: APILogSegment[];
  spans: Record<string, APISpan>;
  fromCheckpoint?: number;
  toCheckpoint?: number;
}

export interface APIButtonSpec {
  location?: {
    componentID: string;
    componentType: string;
  };
  text: string;
  iconName?: string;
  iconSVG?: string;
  disabled?: boolean;
  requiresConfirmation?: boolean;
  inputs?: APIInputSpec[];
}

export interface APIInputSpec {
  name: string;
  label?: string;
  text?: { defaultValue?: string; placeholder?: string };
  bool?: { defaultValue?: boolean; trueString?: string; falseString?: string };
  hidden?: { value?: string };
  choice?: { choices?: string[] };
}

export interface APIButtonStatus {
  lastClickedAt?: string;
  inputs?: APIInputStatus[];
}

export interface APIInputStatus {
  name: string;
  text?: { value: string };
  bool?: { value: boolean };
  hidden?: { value: string };
  choice?: { value: string };
}

export interface APIButton {
  metadata: APIResourceMetadata;
  spec: APIButtonSpec;
  status: APIButtonStatus;
}

export interface APISession {
  metadata: APIResourceMetadata;
  status: {
    tiltStartTime: string; // "2026-02-01T03:54:47.382191Z"
    tiltfileKey: string; // "/path/to/project/Tiltfile"
  };
}

export interface APIViewResponse {
  tiltStartTime: string; // "2026-02-01T03:54:47.382191Z"
  uiSession?: APISession;
  uiResources?: APIResource[];
  uiButtons?: APIButton[];
  logList?: APILogList;
  isComplete: boolean;
}

// FileWatch API types (from /proxy/apis/tilt.dev/v1alpha1/filewatches)

export interface FileWatchIgnore {
  basePath: string;
  patterns?: string[];
}

export interface FileWatchSpec {
  watchedPaths: string[];
  ignores?: FileWatchIgnore[];
}

export interface FileWatchEvent {
  seenFiles: string[];
  time: string;
}

export interface FileWatchStatus {
  fileEvents?: FileWatchEvent[];
  lastEventTime?: string | null;
  error?: string;
}

export interface APIFileWatch {
  metadata: APIResourceMetadata;
  spec: FileWatchSpec;
  status: FileWatchStatus;
}

export interface APIFileWatchList {
  items: APIFileWatch[];
}

// Helper functions for API types

export function isTiltfile(status: APIResourceStatus): boolean {
  return status.order === 1;
}

export function isK8sResource(status: APIResourceStatus): boolean {
  return !!status.k8sResourceInfo;
}

export function isLocalResource(status: APIResourceStatus): boolean {
  return !!status.localResourceInfo;
}

export function getResourceType(status: APIResourceStatus): string {
  for (const spec of status.specs ?? []) {
    if (spec.type) return spec.type;
  }
  if (isTiltfile(status)) return "tiltfile";
  return "";
}

export function isDisabled(status: APIResourceStatus): boolean {
  if (!status.disableStatus) return false;
  // enabledCount may be undefined when disabled, so check disabledCount > 0 and enabledCount is falsy
  return (
    status.disableStatus.disabledCount > 0 && !status.disableStatus.enabledCount
  );
}

export function isBuilding(status: APIResourceStatus): boolean {
  return status.updateStatus === "in_progress";
}

export function getLastBuildError(status: APIResourceStatus): string {
  if (
    status.buildHistory &&
    status.buildHistory.length > 0 &&
    status.buildHistory[0].error
  ) {
    return status.buildHistory[0].error;
  }
  return "";
}

export function isDisableToggleButton(btn: APIButton): boolean {
  return (
    btn.metadata.annotations?.[API_BUTTON_ANNOTATION_TYPE] ===
    API_BUTTON_TOGGLE_DISABLE_TYPE
  );
}
