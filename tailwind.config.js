/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: 'rgba(255,255,255,0.95)',
        muted: 'rgba(255,255,255,0.65)'
      }
    }
  },
  plugins: []
}
