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
