/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        flow: {
          900: '#0a0a0b',
          800: '#141416',
          700: '#1c1c1f',
          600: '#2a2a2e',
          500: '#3a3a3e',
        },
        accent: {
          DEFAULT: '#ff3b30',
          hover: '#e5352b',
        },
        picks: '#22c55e',
        maybe: '#eab308',
        rejects: '#ef4444',
      },
      fontFamily: {
        sans: ['"Cascadia Mono"', 'ui-monospace', 'Consolas', '"Courier New"', 'monospace'],
        mono: ['"Cascadia Mono"', 'ui-monospace', 'Consolas', '"Courier New"', 'monospace'],
      }
    },
  },
  plugins: [],
}
