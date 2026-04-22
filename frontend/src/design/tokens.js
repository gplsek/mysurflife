/**
 * tokens.js — runtime helpers for reading CSS design tokens.
 *
 * CSS custom properties are the source of truth. These helpers bridge
 * the gap when JS code (canvas layers, WebGL shaders) needs the resolved
 * value of a token at runtime.
 */

const _cache = new Map();
let _theme = document.documentElement.getAttribute('data-theme') || 'ocean';

// Invalidate cache when theme changes so callers always get fresh values.
new MutationObserver(() => {
  const next = document.documentElement.getAttribute('data-theme') || 'ocean';
  if (next !== _theme) {
    _theme = next;
    _cache.clear();
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/**
 * Returns the resolved string value of a CSS custom property.
 * Result is cached until the theme changes.
 * @param {string} name  e.g. '--accent' or 'accent'
 * @returns {string}
 */
export function getThemeColor(name) {
  const prop = name.startsWith('--') ? name : `--${name}`;
  if (_cache.has(prop)) return _cache.get(prop);
  const value = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  _cache.set(prop, value);
  return value;
}

/**
 * Converts a CSS color value (oklch, rgb, hex, or a --token name) to
 * an {r, g, b} object with values 0–255. Uses a temporary canvas pixel
 * read to let the browser do the conversion. Returns null on failure.
 * @param {string} color
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function resolveToRgb(color) {
  const resolved = color.startsWith('--') ? getThemeColor(color) : color;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  } catch {
    return null;
  }
}

/**
 * Returns the current theme name: 'ocean' | 'dawn' | 'daylight'
 */
export function currentTheme() {
  return _theme;
}
