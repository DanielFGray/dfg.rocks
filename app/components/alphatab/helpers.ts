import type { json } from "@coderline/alphatab";
import { useEffect, useState } from "react";

export function useColorScheme() {
  const [isDark, setIsDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return isDark;
}

export function getColors(isDark: boolean) {
  return {
    mainColor: isDark ? "#f0f0f0" : "#111827",
    secondaryColor: isDark ? "#a0a0a0" : "#6b7280",
    staffLineColor: isDark ? "#333333" : "#d1d5db",
    barSeparatorColor: isDark ? "#444444" : "#9ca3af",
  };
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const MIN_DISPLAY_SCALE = 0.7;
const MAX_DISPLAY_SCALE = 1.5;

/**
 * The display settings the player starts with in a container of `width`
 * pixels. The server draws static scores with the same settings, so the
 * static score and the player match when the player takes over.
 */
export function notationDisplaySettings(width: number, zoomFactor: number, isDark: boolean) {
  const { scale, stretchForce } = getResponsiveDisplayConfig(width, zoomFactor);
  const colors = getColors(isDark);
  return {
    scale,
    stretchForce,
    staveProfile: "Default",
    resources: {
      mainGlyphColor: colors.mainColor,
      secondaryGlyphColor: colors.secondaryColor,
      scoreInfoColor: colors.mainColor,
      staffLineColor: colors.staffLineColor,
      barSeparatorColor: colors.barSeparatorColor,
    },
  } satisfies json.DisplaySettingsJson;
}

export function getResponsiveDisplayConfig(
  width: number,
  zoomFactor: number,
): { scale: number; stretchForce: number } {
  if (width <= 360) {
    return {
      scale: clampValue(0.78 * zoomFactor, MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE),
      stretchForce: 0.82,
    };
  }

  if (width <= 420) {
    return {
      scale: clampValue(0.84 * zoomFactor, MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE),
      stretchForce: 0.88,
    };
  }

  if (width <= 520) {
    return {
      scale: clampValue(0.9 * zoomFactor, MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE),
      stretchForce: 0.94,
    };
  }

  if (width < 768) {
    return {
      scale: clampValue(0.96 * zoomFactor, MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE),
      stretchForce: 0.97,
    };
  }

  return {
    scale: clampValue(zoomFactor, MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE),
    stretchForce: 1,
  };
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
