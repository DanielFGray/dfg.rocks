/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		extend: {
			colors: {
				surface: '#0e0e0e',
				card: '#1a1a1a',
				primary: '#f0f0f0',
				muted: '#a0a0a0',
				accent: {
					DEFAULT: '#e08a3c',
					hover: '#c97530',
				},
			},
			fontFamily: {
				sans: ['"DM Sans"', 'sans-serif'],
			},
		},
	},
	plugins: [],
}
