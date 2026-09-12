// Thin wrapper over defaultTheme for future-proofing (e.g. dynamic themes)

import { defaultTheme, type Theme } from "@/theme/theme";

export function useTheme(): Theme {
  return defaultTheme;
}
