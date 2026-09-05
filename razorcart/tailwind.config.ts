import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--surface-canvas)',
        paper: 'var(--surface-paper)',
        ink: 'var(--ink-primary)',
        muted: 'var(--ink-muted)',
        line: 'var(--border-default)',
        accent: 'var(--accent-solid)',
      },
      fontFamily: {
        display: ['Fraunces Variable', 'Georgia', 'serif'],
        sans: ['Manrope Variable', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
