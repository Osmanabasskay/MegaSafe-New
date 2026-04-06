import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#F97316',
          blue: '#1D4ED8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
