/** @type {import('tailwindcss').Config} */
export default {
  content: [
    // Include all source files from apps and packages
    './src/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // eventools.io brand colors
        eventools: {
          orange: '#FF6B35',
          DEFAULT: '#FF6B35',
        },
        prod: {
          red: '#EF4444',
          DEFAULT: '#EF4444',
        },
        sound: {
          blue: '#3B82F6',
          DEFAULT: '#3B82F6',
        },
        video: {
          purple: '#8B5CF6',
          DEFAULT: '#8B5CF6',
        },
        budget: {
          green: '#10B981',
          DEFAULT: '#10B981',
        },
        light: {
          yellow: '#F59E0B',
          DEFAULT: '#F59E0B',
        },
        inventory: {
          teal: '#14B8A6',
          DEFAULT: '#14B8A6',
        },
        labor: {
          indigo: '#6366F1',
          DEFAULT: '#6366F1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
};
