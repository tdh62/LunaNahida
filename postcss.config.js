import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import textScale from './scripts/text-scale-postcss.mjs';

export default {
  plugins: [tailwindcss(), textScale(), autoprefixer()],
};
