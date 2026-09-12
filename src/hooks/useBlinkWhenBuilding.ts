// Hook for blinking color animation when a resource is building

import { createSignal, createMemo, Accessor } from "solid-js";
import { parseColor, RGBA } from "@opentui/core";
import { useTimeline } from "@opentui/solid";
import { ResourceStatus } from "../tilt/types";
import { defaultTheme, statusColor, type Theme } from "../theme/theme";

export interface UseBlinkWhenBuildingOptions {
  /** The theme to use for colors (defaults to defaultTheme) */
  theme?: Theme;
  /** Animation duration in ms (defaults to 2000) */
  duration?: number;
}

export interface BlinkWhenBuildingResult {
  /** The current opacity value (0-1) for the blink animation */
  opacity: Accessor<number>;
  /** Get the color for a status, blinking if building */
  getBlinkingColor: (
    status: ResourceStatus,
    isBuilding: boolean,
    isDisabled?: boolean,
  ) => string | RGBA;
}

/**
 * Hook that provides a blinking animation for status colors when a resource is building.
 *
 * @example
 * ```tsx
 * const { opacity, getBlinkingColor } = useBlinkWhenBuilding();
 *
 * // Use with a status indicator
 * const color = () => getBlinkingColor(resource.runtimeStatus, resource.isBuilding);
 *
 * // Or use opacity directly for other elements
 * <text style={{ opacity: opacity() }}>Building...</text>
 * ```
 */
export function useBlinkWhenBuilding(
  options: UseBlinkWhenBuildingOptions = {},
): BlinkWhenBuildingResult {
  const { theme = defaultTheme, duration = 2000 } = options;

  const [opacity, setOpacity] = createSignal(0);

  const timeline = useTimeline({
    duration,
    loop: true,
  });

  timeline.add(
    { opacity: 0 },
    {
      opacity: 100,
      duration,
      ease: "inOutCirc",
      onUpdate: ({ currentTime }) => {
        // opacity value should look like ^. linear increase up to
        // duration/2 then linear decrease back to zero for the
        // remainder of the duration
        const halfDuration = duration / 2;
        const opacityValue =
          (currentTime < halfDuration ? currentTime : duration - currentTime) /
          halfDuration;

        setOpacity(opacityValue);
      },
    },
    0,
  );

  const getBlinkingColor = (
    status: ResourceStatus,
    isBuilding: boolean,
    isDisabled?: boolean,
  ): string | RGBA => {
    if (isDisabled) {
      return theme.textMuted;
    }

    const hex = statusColor(theme, status);
    if (!isBuilding) {
      return hex;
    }

    const rgb = parseColor(hex);
    return RGBA.fromValues(rgb.r, rgb.g, rgb.b, opacity());
  };

  return {
    opacity,
    getBlinkingColor,
  };
}
