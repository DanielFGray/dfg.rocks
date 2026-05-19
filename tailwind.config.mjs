import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "media",
  content: ["./src/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#fafafa",
          dark: "#0e0e0e",
        },
        card: {
          DEFAULT: "#ffffff",
          dark: "#1a1a1a",
        },
        primary: {
          DEFAULT: "#111827",
          dark: "#f0f0f0",
        },
        muted: {
          DEFAULT: "#6b7280",
          dark: "#a0a0a0",
        },
        accent: {
          DEFAULT: "#e08a3c",
          hover: "#c97530",
        },
        overlay: {
          DEFAULT: "#000000",
          dark: "#ffffff",
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', "sans-serif"],
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            a: { color: theme("colors.accent.DEFAULT") },
            "a:hover": { color: theme("colors.accent.hover") },
          },
        },
        invert: {
          css: {
            a: { color: theme("colors.accent.DEFAULT") },
            "a:hover": { color: theme("colors.accent.hover") },
          },
        },
      }),
    },
  },
  plugins: [typography],
};
