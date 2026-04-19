/**
 * ramps.js — frontend interface to the shared color ramp configuration.
 *
 * Source of truth: backend/config/ramps.json (copied to src/config/ramps.json at build time).
 * Backend tile renderer and this file both read the same JSON, ensuring
 * tile colors and legend colors are always in sync.
 *
 * Available ramps: 'wind_speed' | 'wave_height' | 'wave_period'
 */

import rampsData from '../config/ramps.json';

/**
 * Returns the stop array for a named ramp.
 * Each stop: { value, rgba: [r, g, b, a], label }
 * @param {string} name
 * @returns {Array}
 */
export function rampStops(name) {
  const ramp = rampsData.ramps[name];
  if (!ramp) throw new Error(`Unknown ramp: "${name}". Available: ${Object.keys(rampsData.ramps).join(', ')}`);
  return ramp.stops;
}

/**
 * Returns [min, max] domain for a named ramp.
 * @param {string} name
 * @returns {[number, number]}
 */
export function rampDomain(name) {
  const ramp = rampsData.ramps[name];
  if (!ramp) throw new Error(`Unknown ramp: "${name}"`);
  return ramp.domain;
}

/**
 * Samples a ramp at a given value, returning { r, g, b, a } with
 * r/g/b in 0–255 and a in 0–1. Clamps to domain edges.
 * @param {string} name
 * @param {number} value
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
export function sampleRamp(name, value) {
  const stops = rampStops(name);
  const [min, max] = rampDomain(name);
  const clamped = Math.max(min, Math.min(max, value));

  // Find surrounding stops
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].value && clamped <= stops[i + 1].value) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }

  if (lo === hi) {
    const [r, g, b, a] = lo.rgba;
    return { r, g, b, a };
  }

  const t = (clamped - lo.value) / (hi.value - lo.value);
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  const lerpA = (a, b) => a + (b - a) * t;

  return {
    r: lerp(lo.rgba[0], hi.rgba[0]),
    g: lerp(lo.rgba[1], hi.rgba[1]),
    b: lerp(lo.rgba[2], hi.rgba[2]),
    a: lerpA(lo.rgba[3], hi.rgba[3]),
  };
}

/**
 * Returns the rgba() CSS string for a sampled ramp value.
 * Convenient for canvas fillStyle / strokeStyle.
 * @param {string} name
 * @param {number} value
 * @returns {string}  e.g. "rgba(120, 200, 220, 0.55)"
 */
export function sampleRampCss(name, value) {
  const { r, g, b, a } = sampleRamp(name, value);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/**
 * Returns the theme_accents block for a given theme name.
 * @param {string} theme  'ocean' | 'dawn' | 'daylight'
 * @returns {object}
 */
export function themeAccents(theme) {
  return rampsData.theme_accents[theme] || rampsData.theme_accents.ocean;
}
