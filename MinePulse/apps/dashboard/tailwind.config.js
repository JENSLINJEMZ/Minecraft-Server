/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0b0f14',
        surface: {
          DEFAULT: '#121821',
          muted: '#0f141c',
          raised: '#1a2230',
          hover: '#1e2735',
        },
        border: {
          DEFAULT: '#24303f',
          muted: '#1b2532',
        },
        content: {
          DEFAULT: '#e6edf5',
          muted: '#93a4b8',
          faint: '#64748b',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#7c7ff5',
          soft: 'rgba(99,102,241,0.12)',
        },
        status: {
          online: '#22c55e',
          degraded: '#f59e0b',
          stale: '#eab308',
          offline: '#ef4444',
        },
        severity: {
          info: '#38bdf8',
          warning: '#f59e0b',
          critical: '#ef4444',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(99,102,241,0.35), 0 8px 30px -8px rgba(99,102,241,0.45)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
};
