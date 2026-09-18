import type {Config} from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#f8fafc',
        slate: '#94a3b8',
        line: 'rgba(255,255,255,0.1)',
        canvas: '#0d111b',
        brand: '#3157d5',
        signal: '#c36b16'
      },
      boxShadow: {
        panel: '0 10px 30px rgba(30, 48, 80, 0.07)'
      }
    }
  },
  plugins: []
};

export default config;
