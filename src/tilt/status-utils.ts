import {
  UpdateStatus,
  RuntimeStatus,
  APIResource,
  APIResourceStatus,
} from "./api-types";
import { Resource, ResourceDisableState, ResourceStatus } from "./types";

export function resourceIsDisabled(resource: APIResource | undefined): boolean {
  if (!resource) {
    return false;
  }

  // Consider both "pending" and "disabled" states as disabled resources
  const disableState = resource.status?.disableStatus?.state;
  if (
    disableState === ResourceDisableState.Pending ||
    disableState === ResourceDisableState.Disabled
  ) {
    return true;
  }

  return false;
}

export function buildStatus(r: APIResource): ResourceStatus {
  let res: APIResourceStatus = r.status || {};

  if (resourceIsDisabled(r)) {
    return ResourceStatus.Disabled;
  } else if (res.updateStatus == UpdateStatus.InProgress) {
    return ResourceStatus.Building;
  } else if (res.updateStatus == UpdateStatus.Pending) {
    return ResourceStatus.Pending;
  } else if (
    res.updateStatus == UpdateStatus.NotApplicable ||
    res.updateStatus == UpdateStatus.None
  ) {
    return ResourceStatus.None;
  } else if (res.updateStatus == UpdateStatus.Error) {
    return ResourceStatus.Unhealthy;
  } else if (res.updateStatus == UpdateStatus.Ok) {
    return ResourceStatus.Healthy;
  }
  return ResourceStatus.None;
}

export function runtimeStatus(r: APIResource): ResourceStatus {
  let res: APIResourceStatus = r.status || {};

  // Regardless of warning logs, check if a resource
  // is disabled to return a disabled status
  if (resourceIsDisabled(r)) {
    return ResourceStatus.Disabled;
  }

  switch (res.runtimeStatus) {
    case RuntimeStatus.Error:
      return ResourceStatus.Unhealthy;
    case RuntimeStatus.Pending:
      return ResourceStatus.Pending;
    case RuntimeStatus.Ok:
      return ResourceStatus.Healthy;
    case RuntimeStatus.NotApplicable:
    case RuntimeStatus.None:
      return ResourceStatus.None;
  }
  return ResourceStatus.None;
}

// Duration (ms) from when the deploy finished rolling out until the runtime
// reported Ready. Returns undefined when the data needed to compute it is
// unavailable (e.g. not ready yet, or a non-k8s resource).
export function runtimeReadinessDurationMs(r: APIResource): number | undefined {
  const status = r.status || {};

  // Only meaningful once the runtime is actually Ok/ready.
  if (status.runtimeStatus !== RuntimeStatus.Ok) return undefined;

  const readyCondition = status.conditions?.find((c) => c.type === "Ready");
  if (!readyCondition || readyCondition.status !== "True") return undefined;
  const readyAt = new Date(readyCondition.lastTransitionTime).getTime();
  if (Number.isNaN(readyAt)) return undefined;

  // Start counting from when the latest deploy began rolling out the runtime.
  const startCandidates = [
    status.k8sResourceInfo?.podUpdateStartTime,
    status.k8sResourceInfo?.podCreationTime,
    status.buildHistory?.[0]?.finishTime,
    status.lastDeployTime,
  ];

  for (const candidate of startCandidates) {
    if (!candidate) continue;
    const startAt = new Date(candidate).getTime();
    if (Number.isNaN(startAt)) continue;
    const duration = readyAt - startAt;
    if (duration >= 0) return duration;
  }

  return undefined;
}

export function getEffectiveStatus(resource: Resource): ResourceStatus {
  if (
    resource.runtimeStatus === ResourceStatus.Unhealthy ||
    resource.updateStatus === ResourceStatus.Unhealthy
  ) {
    return ResourceStatus.Unhealthy;
  }

  if (
    resource.runtimeStatus === ResourceStatus.Building ||
    resource.updateStatus === ResourceStatus.Building
  ) {
    return ResourceStatus.Building;
  }

  if (
    resource.runtimeStatus === ResourceStatus.Pending ||
    resource.updateStatus === ResourceStatus.Pending
  ) {
    return ResourceStatus.Pending;
  }

  if (
    resource.runtimeStatus === ResourceStatus.Healthy ||
    resource.updateStatus === ResourceStatus.Healthy
  ) {
    return ResourceStatus.Healthy;
  }

  return ResourceStatus.None;
}
