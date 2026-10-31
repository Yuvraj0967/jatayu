/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        panel: 'var(--panel)',
        panel2: 'var(--panel2)',
        hair: 'var(--hair)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        band: 'var(--band)',
        bandink: 'var(--band-ink)',
        safety: 'var(--mint)',
        mint: 'var(--mint)',
        mintsoft: 'var(--mint-soft)',
        mintdeep: 'var(--mint-deep)',
        good: 'var(--good)',
        warning: 'var(--warning)',
        serious: 'var(--serious)',
        critical: 'var(--critical)',
        select: 'var(--select)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        display: ['var(--font-display)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      borderRadius: {
        panel: '16px',
      },
      maxWidth: {
        page: '1520px',
      },
    },
  },
  plugins: [],
}
