// data.jsx — mock data for the surf forecasting prototype

const SPOTS = [
  { id: 'lowers', name: 'Lower Trestles', region: 'San Clemente, CA', lat: 33.380, lon: -117.588, x: 0.22, y: 0.58, rating: 4, swell: 4.2, period: 14, wind: 6, windDir: 285, tide: 'rising', temp: 64, label: 'FIRING' },
  { id: 'pipeline', name: 'Pipeline', region: 'Oahu, HI', lat: 21.665, lon: -158.053, x: 0.12, y: 0.48, rating: 5, swell: 8.1, period: 16, wind: 4, windDir: 90, tide: 'low', temp: 78, label: 'PUMPING' },
  { id: 'mavericks', name: 'Mavericks', region: 'Half Moon Bay, CA', lat: 37.491, lon: -122.501, x: 0.18, y: 0.38, rating: 3, swell: 12.4, period: 18, wind: 14, windDir: 320, tide: 'high', temp: 54, label: 'HEAVY' },
  { id: 'ocean-beach', name: 'Ocean Beach', region: 'San Francisco, CA', lat: 37.759, lon: -122.511, x: 0.19, y: 0.35, rating: 2, swell: 6.5, period: 12, wind: 18, windDir: 310, tide: 'rising', temp: 56, label: 'CHOPPY' },
  { id: 'rincon', name: 'Rincon', region: 'Santa Barbara, CA', lat: 34.373, lon: -119.477, x: 0.21, y: 0.52, rating: 4, swell: 3.8, period: 15, wind: 5, windDir: 90, tide: 'mid', temp: 62, label: 'CLEAN' },
  { id: 'malibu', name: 'Malibu First Point', region: 'Malibu, CA', lat: 34.037, lon: -118.678, x: 0.225, y: 0.55, rating: 3, swell: 3.2, period: 13, wind: 7, windDir: 270, tide: 'rising', temp: 63, label: 'FUN' },
  { id: 'nazare', name: 'Nazaré', region: 'Portugal', lat: 39.601, lon: -9.075, x: 0.47, y: 0.38, rating: 5, swell: 22.0, period: 19, wind: 9, windDir: 60, tide: 'mid', temp: 60, label: 'XXL' },
  { id: 'mundaka', name: 'Mundaka', region: 'Basque Country', lat: 43.408, lon: -2.695, x: 0.49, y: 0.34, rating: 3, swell: 5.4, period: 14, wind: 8, windDir: 180, tide: 'low', temp: 58, label: 'CLEAN' },
  { id: 'hossegor', name: 'Hossegor', region: 'France', lat: 43.664, lon: -1.441, x: 0.49, y: 0.33, rating: 4, swell: 6.8, period: 13, wind: 6, windDir: 110, tide: 'mid', temp: 61, label: 'FIRING' },
  { id: 'cloudbreak', name: 'Cloudbreak', region: 'Fiji', lat: -17.875, lon: 177.200, x: 0.82, y: 0.72, rating: 5, swell: 7.2, period: 15, wind: 5, windDir: 120, tide: 'high', temp: 80, label: 'PERFECT' },
  { id: 'teahupoo', name: 'Teahupo\u02bbo', region: 'Tahiti', lat: -17.847, lon: -149.267, x: 0.06, y: 0.70, rating: 4, swell: 6.0, period: 16, wind: 7, windDir: 100, tide: 'rising', temp: 79, label: 'HEAVY' },
  { id: 'jbay', name: "J-Bay", region: 'South Africa', lat: -34.052, lon: 24.929, x: 0.55, y: 0.78, rating: 4, swell: 5.2, period: 14, wind: 4, windDir: 290, tide: 'mid', temp: 62, label: 'FIRING' },
  { id: 'uluwatu', name: 'Uluwatu', region: 'Bali', lat: -8.816, lon: 115.089, x: 0.735, y: 0.68, rating: 4, swell: 4.8, period: 14, wind: 10, windDir: 135, tide: 'mid', temp: 82, label: 'SOLID' },
  { id: 'snapper', name: 'Snapper Rocks', region: 'Gold Coast, AU', lat: -28.164, lon: 153.550, x: 0.87, y: 0.74, rating: 3, swell: 3.4, period: 11, wind: 8, windDir: 180, tide: 'low', temp: 74, label: 'FUN' },
];

// 7 days × 24 hourly forecast for the selected spot (swell ft, wind mph, rating 0..5)
function genForecast(seed = 1) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const t = d * 24 + h;
      const swell = 2.5 + Math.sin(t / 14 + seed) * 1.6 + Math.sin(t / 37) * 1.2 + (d > 3 ? (d - 3) * 0.8 : 0);
      const wind  = 6 + Math.sin(t / 9 + seed * 1.7) * 4 + Math.cos(t / 23) * 2;
      const tide  = Math.sin(t / 6.2 + seed) * 3 + 3; // 0..6
      const rating = Math.max(0, Math.min(5, 3 + Math.sin(t / 18 + seed) * 2 - Math.abs(wind - 6) * 0.15));
      out.push({ t, d, h, swell: +swell.toFixed(1), wind: +wind.toFixed(1), tide: +tide.toFixed(1), rating: +rating.toFixed(1), period: 10 + Math.round(Math.sin(t / 30) * 4 + 4), dir: 270 + Math.sin(t / 18) * 40 });
    }
  }
  return out;
}

const SESSIONS = [
  { date: '2026-04-18', spot: 'Lower Trestles', duration: 118, waves: 14, rating: 5, swell: 4.2, wind: 6, note: 'Dawn patrol. Glassy til 8:30. Got the wave of the week at 7:42 — long left, two gaffes, clean drop.' },
  { date: '2026-04-16', spot: 'Malibu First Point', duration: 95, waves: 9, rating: 3, swell: 2.8, wind: 11, note: 'Crowded as usual. Onshore came up early. Board felt sluggish — maybe try the 5\'10".' },
  { date: '2026-04-14', spot: 'Rincon', duration: 140, waves: 22, rating: 5, swell: 5.1, wind: 4, note: 'Reeled off a set wave from the cove all the way to the highway. Legs cooked.' },
  { date: '2026-04-11', spot: 'Ocean Beach', duration: 52, waves: 4, rating: 2, swell: 8.0, wind: 19, note: 'Got worked. Paddled back in. Not my day.' },
  { date: '2026-04-08', spot: 'Lower Trestles', duration: 105, waves: 11, rating: 4, swell: 3.4, wind: 7, note: 'Clean but small. Fun for the longboard.' },
  { date: '2026-04-05', spot: 'Rincon', duration: 120, waves: 16, rating: 4, swell: 4.0, wind: 5, note: 'Family on the beach. Surfed the Rivermouth. Tide dropped fast.' },
];

const ALERTS = [
  { id: 1, spot: 'Lower Trestles', condition: 'Swell > 4ft AND Wind < 10mph', channel: 'push', active: true, lastTriggered: '2h ago' },
  { id: 2, spot: 'Rincon', condition: 'Period > 14s AND Offshore wind', channel: 'push + email', active: true, lastTriggered: 'Yesterday' },
  { id: 3, spot: 'Mavericks', condition: 'Swell > 15ft (Big-wave alert)', channel: 'push', active: true, lastTriggered: '4d ago' },
  { id: 4, spot: 'Ocean Beach', condition: 'Clean morning window', channel: 'email', active: false, lastTriggered: 'Never' },
  { id: 5, spot: 'All favorited', condition: 'AI predicts "firing" (confidence > 80%)', channel: 'push', active: true, lastTriggered: '1h ago', ai: true },
];

Object.assign(window, { SPOTS, SESSIONS, ALERTS, genForecast });
