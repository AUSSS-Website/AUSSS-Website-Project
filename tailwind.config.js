/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        forest: {
          DEFAULT: '#06402B',
          950: '#021c12',
          900: '#042518',
          800: '#063522',
          700: '#06402B',
          600: '#0a5c3e',
          500: '#0f7a53',
        },
        medical: {
          DEFAULT: '#5B8DB8',
          light: '#8FB4D4',
        },
        silver: {
          DEFAULT: '#C9D6DF',
          light: '#EEF2F5',
        },
        cream: '#FAFCFB',
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(28px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.95)', opacity: '0.7' },
          '70%': { transform: 'scale(1.25)', opacity: '0' },
          '100%': { opacity: '0' },
        },
        // One reveal line, fading in and back out within its dwell so the
        // Sorting deliberation reads slowly and dramatically.
        reveal: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '20%, 80%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-10px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 1.2s ease-out both',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        reveal: 'reveal 2000ms ease-in-out both',
      },
    },
  },
  plugins: [],
}
