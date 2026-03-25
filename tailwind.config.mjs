/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
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
