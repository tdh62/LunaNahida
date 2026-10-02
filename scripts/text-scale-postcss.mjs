// Scale typography without changing rem-based spacing or the window's geometry.
// Lyrics have their own size controls; relative/inherited sizes must not scale twice.
export default function textScale() {
  const length = /^(?:\d*\.)?\d+(?:px|rem)$/;
  const scaled = value => `calc(${value} * var(--ui-text-scale, 1))`;
  return {
    postcssPlugin: 'lunanahida-text-scale',
    Declaration(declaration) {
      const rule = declaration.parent;
      if (rule.type !== 'rule' || /\.(?:lyric-line|immersive-line)\b|\.immersive-lyrics\s+p\b/.test(rule.selector)) return;
      const { prop, value } = declaration;
      if ((prop === 'font-size' || prop === 'line-height') && length.test(value) && parseFloat(value) > 0) {
        declaration.value = scaled(value);
      } else if (prop === 'font-size' && /^(?:clamp|min|max)\(/.test(value)) {
        declaration.value = scaled(value);
      } else if (prop === 'font') {
        // Match the size after optional style/variant/weight tokens, before the family.
        declaration.value = value.replace(/^((?:(?:normal|italic|oblique|small-caps|bold|bolder|lighter|[1-9]00)\s+)*)(\d*\.?\d+(?:px|rem))(?:\/(\d*\.?\d+(?:px|rem)))?(?=[\s/])/, (_, prefix, size, height) => `${prefix}${scaled(size)}${height ? '/' + scaled(height) : ''}`);
      }
    },
  };
}
textScale.postcss = true;
