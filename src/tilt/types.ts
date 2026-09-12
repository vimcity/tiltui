// View Model Types - UI-specific processed types for display
// These types are derived from API types and optimized for UI consumption

import {
  type APIResource,
  type APIButton,
  type APIInputSpec,
  getResourceType,
  isDisabled,
  getLastBuildError,
  isBuilding,
} from "./api-types";

// Re-export API types that are used directly by consumers
export type {
  APIResource,
  APIButton,
  APIInputSpec,
  APILogList,
  APILogSegment,
  APIInputStatus,
} from "./api-types";

import {
  API_BUTTON_ANNOTATION_TYPE,
  API_BUTTON_TOGGLE_DISABLE_TYPE,
  isDisableToggleButton as isAPIButtonDisableToggle,
} from "./api-types";
import { runtimeStatus, buildStatus } from "./status-utils";

export { API_BUTTON_ANNOTATION_TYPE, API_BUTTON_TOGGLE_DISABLE_TYPE };

export enum ResourceName {
  tiltfile = "(Tiltfile)",
  all = "(all)",
  starred = "(starred)",
}

// Processed types for UI display

export interface LogEntry {
  timestamp: Date;
  spanId: string;
  level: string;
  text: string;
  source: string;
}

export type LogLevel = "INFO" | "WARN" | "ERROR";

// A plaintext representation of a line of the log,
// with metadata to render it in isolation.
//
// The metadata should be stored as primitive fields
// so that React's default caching behavior will kick in.
export interface LogLine {
  // We assume that 'text' does not contain a newline
  text: string;
  manifestName: string;
  level: LogLevel;
  buildEvent?: string;
  spanId: string;

  // The index of this line in the LogStore StoredLine list.
  storedLineIndex: number;

  // Timestamp of the log line (ISO 8601 format)
  time?: string;
}

// Instructions on how to patch an existing log stream with new logs.
// Includes:
// - The lines to add. Some of these might patch existing lines.
// - A client-side checkpoint, for determining the next patch
//   Users of this API should not modify this. They should just pass it to
//   the next invocation of the log getter. 0 indicates we will get all logs.
export interface LogPatchSet {
  lines: LogLine[];
  checkpoint: number;
}

export interface EndpointLink {
  name: string;
  url: string;
}

export interface ButtonAction {
  name: string;
  text: string;
  resourceName: string;
  disabled: boolean;
  inputs: APIInputSpec[];
  /** Raw APIButton for API calls - includes metadata.resourceVersion */
  raw: APIButton;
}

// What is the status of the resource with respect to Tilt
export enum ResourceStatus {
  Building = "Building", // Tilt is actively doing something (e.g., docker build or kubectl apply)
  Pending = "Pending", // not building, healthy, or unhealthy, but presumably on its way to one of those (e.g., queued to build, or ContainerCreating)
  Healthy = "Healthy", // e.g., build succeeded and pod is running and healthy
  Unhealthy = "Unhealthy", // e.g., last build failed, or CrashLoopBackOff
  Warning = "Warning", // e.g., an undismissed restart
  Disabled = "Disabled", // e.g., a resource is disabled by the user through the API / UI
  None = "None", // e.g., a manual build that has never executed
}

// These constants are duplicated from the Go constants.
export enum ResourceDisableState {
  Disabled = "Disabled",
  Enabled = "Enabled",
  Error = "Error",
  Pending = "",
}

export interface Resource {
  name: string;
  type: string;
  runtimeStatus: ResourceStatus;
  updateStatus: ResourceStatus;
  lastDeployAt: string;
  buildError: string;
  podStatus: string;
  podName: string;
  endpoints: EndpointLink[];
  isDisabled: boolean;
  isBuilding: boolean;
  order: number;
  buttons: ButtonAction[];
  /** The disable toggle button for this resource (if it exists) */
  disableToggleButton?: APIButton;
  raw: APIResource;
}

// Conversion functions

export function resourceFromAPIResource(apiResource: APIResource): Resource {
  const resource: Resource = {
    name: apiResource.metadata.name,
    runtimeStatus: runtimeStatus(apiResource),
    updateStatus: buildStatus(apiResource),
    type: getResourceType(apiResource.status),
    isDisabled: isDisabled(apiResource.status),
    isBuilding: isBuilding(apiResource.status),
    buildError: getLastBuildError(apiResource.status),
    order: apiResource.status.order,
    lastDeployAt: apiResource.status.lastDeployTime ?? "",
    podStatus: "",
    podName: "",
    endpoints: [],
    buttons: [],
    raw: apiResource,
  };

  // Get endpoint links
  for (const link of apiResource.status.endpointLinks ?? []) {
    resource.endpoints.push({
      name: link.name || link.url,
      url: link.url,
    });
  }

  // Get K8s-specific info
  if (apiResource.status.k8sResourceInfo) {
    resource.podStatus = apiResource.status.k8sResourceInfo.podStatus;
    resource.podName = apiResource.status.k8sResourceInfo.podName;
  }

  return resource;
}

export function buttonActionFromAPIButton(btn: APIButton): ButtonAction {
  return {
    name: btn.metadata.name,
    text: btn.spec.text,
    resourceName:
      btn.spec.location?.componentType === "Resource"
        ? btn.spec.location.componentID
        : "",
    disabled: btn.spec.disabled ?? false,
    inputs: btn.spec.inputs ?? [],
    raw: btn,
  };
}

/**
 * Check if a button (either APIButton or ButtonAction) is a disable toggle button.
 * Works with both raw API buttons and processed ButtonAction objects.
 */
export function isDisableToggleButton(btn: APIButton | ButtonAction): boolean {
  // ButtonAction has a 'raw' property, APIButton does not
  if ("raw" in btn) {
    return isAPIButtonDisableToggle(btn.raw);
  }
  return isAPIButtonDisableToggle(btn);
}
