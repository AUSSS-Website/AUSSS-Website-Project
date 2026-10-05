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
        // Theme tokens: one name, two palettes. The values live in
        // src/index.css (`:root` for light, `.dark` for dark), so a page is
        // written once and follows the theme. Use these for anything that
        // must change with the theme; the fixed colours above are for things
        // that look the same in both (a blue button, a photo's scrim).
        page: 'rgb(var(--c-page) / <alpha-value>)', // the page itself
        sunk: 'rgb(var(--c-sunk) / <alpha-value>)', // inputs, alternate bands
        card: 'rgb(var(--c-card) / <alpha-value>)', // raised panels
        ink: 'rgb(var(--c-ink) / <alpha-value>)', // headings, strong text
        // Body and muted text. Its opacity steps are remapped per theme so
        // the faintest step still meets WCAG AA (see index.css).
        soft: 'rgb(var(--c-soft) / max(calc(var(--soft-k) * <alpha-value>), calc(var(--soft-c0) + var(--soft-c1) * <alpha-value>)))',
        // Hairlines (borders, dividers, rings) and translucent fills. Each
        // has a strength multiplier, since a 10% line that reads on dark
        // green is too faint on white.
        line: 'rgb(var(--c-line) / calc(var(--line-k) * <alpha-value>))',
        veil: 'rgb(var(--c-veil) / calc(var(--veil-k) * <alpha-value>))',
        // The green button, green in both themes: a fresh mid green on
        // light, the deep forest on dark. White text on it.
        leaf: 'rgb(var(--c-leaf) / <alpha-value>)',
        'leaf-hover': 'rgb(var(--c-leaf-hover) / <alpha-value>)',
        // The inverse button: a white pill with forest text on dark, the
        // green button (leaf) with white text on light.
        solid: 'rgb(var(--c-solid) / <alpha-value>)',
        'solid-hover': 'rgb(var(--c-solid-hover) / <alpha-value>)',
        'on-solid': 'rgb(var(--c-on-solid) / <alpha-value>)',
        // The blue button: scientific blue with dark text on dark, a deep
        // blue with white text on light, where the lighter blue looks washed
        // out. Always the three together: bg-cta text-on-cta hover:bg-cta-hover.
        cta: 'rgb(var(--c-cta) / <alpha-value>)',
        'cta-hover': 'rgb(var(--c-cta-hover) / <alpha-value>)',
        'on-cta': 'rgb(var(--c-on-cta) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)', // blue text and links
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        ok: 'rgb(var(--c-ok) / <alpha-value>)',
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
