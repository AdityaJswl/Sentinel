import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--surface-paper)',
        canvas: 'var(--surface-canvas)',
        ink: 'var(--ink-primary)',
        jade: 'var(--accent-solid)',
      },
      fontFamily: {
        display: ['Fraunces Variable', 'Georgia', 'serif'],
        sans: ['Manrope Variable', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
