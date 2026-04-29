/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', 'monospace'],
        'display': ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'trading-bg': '#0E1116',
        'trading-text': '#E0E6ED',
        'trading-bullish': '#22C55E',
        'trading-bearish': '#EF4444',
        'trading-neutral': '#64748B',
        'candle-bull': '#26A69A',
        'candle-bear': '#EF5350',
        // New precision terminal palette
        'terminal': {
          'black': '#0A0C0F',
          'dark': '#12151A',
          'surface': '#1A1E24',
          'border': '#2A2F38',
          'muted': '#4A5568',
        },
        'accent': {
          'cyan': '#00D9FF',
          'cyan-dim': '#00A3BF',
          'green': '#00FF88',
          'green-dim': '#00CC6A',
          'red': '#FF3B5C',
          'red-dim': '#CC2E4A',
          'amber': '#FFB800',
          'purple': '#A855F7',
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 217, 255, 0.3)',
        'glow-green': '0 0 20px rgba(0, 255, 136, 0.3)',
        'glow-red': '0 0 20px rgba(255, 59, 92, 0.3)',
        'glow-sm-cyan': '0 0 10px rgba(0, 217, 255, 0.2)',
        'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'price-flash': 'price-flash 0.3s ease-out',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.8', filter: 'brightness(1.2)' },
        },
        'price-flash': {
          '0%': { transform: 'scale(1.05)', opacity: '0.8' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      backdropBlur: {
        'xs': '2px',
      },
    },
  },
  plugins: [],
}
