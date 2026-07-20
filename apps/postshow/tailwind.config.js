/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        shell: {
          0: 'var(--shell-0)',
          1: 'var(--shell-1)',
          2: 'var(--shell-2)',
          3: 'var(--shell-3)',
          fg: 'var(--shell-fg)',
          'fg-2': 'var(--shell-fg-2)',
          'fg-3': 'var(--shell-fg-3)',
        },
        night: {
          0: 'var(--night-0)',
          1: 'var(--night-1)',
          2: 'var(--night-2)',
          3: 'var(--night-3)',
          4: 'var(--night-4)',
          fg: 'var(--night-fg)',
          'fg-2': 'var(--night-fg-2)',
          'fg-3': 'var(--night-fg-3)',
        },
        signal: {
          DEFAULT: 'var(--signal)',
          hover: 'var(--signal-hover)',
          ink: 'var(--signal-ink)',
          deep: 'var(--signal-deep)',
        },
        warn: 'var(--warn)',
        bad: 'var(--bad)',
      },
      fontFamily: {
        'public-sans': 'var(--font-public-sans)',
        'public-mono': 'var(--font-public-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
    },
  },
  plugins: [],
};
