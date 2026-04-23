import { useTheme } from '../design/ThemeProvider';
import {
  Compass, SwellRow, SwellBreakdown, ConditionsGrid,
  StripChart, StripChartStack, DayPicker, ForecastScrubber,
  SpotTitle, BreakFacts, SessionInsightCard,
} from '../components/spot';

const MOCK_SWELLS = [
  { height_ft: 4.2, period_s: 15, direction_deg: 290, color: 'var(--s1)', ring: 'mid', name: 'NW groundswell', source_label: '290° · 1,240nm', size_ft: 4.2, direction_label: 'WNW', category: 3 },
  { height_ft: 2.1, period_s: 12, direction_deg: 185, color: 'var(--s2)', ring: 'mid', name: 'S swell',         source_label: '185° · 620nm',   size_ft: 2.1, direction_label: 'S',   category: 1 },
  { height_ft: 1.4, period_s:  9, direction_deg: 220, color: 'var(--s3)', ring: 'inner', name: 'SW wind swell', source_label: '220° · 80nm',    size_ft: 1.4, direction_label: 'SW',  category: 0 },
];
const MOCK_WIND = { speed_mph: 6, direction_deg: 90, color: 'var(--wind)' };
const MOCK_CONDITIONS = {
  wave_face_ft: 4.2, category: 3, category_label: 'chest-to-shoulder',
  period_s: 15, period_label: 'Groundswell',
  primary_dir_deg: 290, primary_dir_label: 'WNW',
  wind_mph: 6, wind_label: 'Light E · offshore',
  tide_ft: 2.1, tide_trend: 'rising', tide_position: 'mid',
  water_temp_f: 61, wetsuit: '3/2',
};
const MOCK_TIMELINE = Array.from({ length: 169 }, (_, t) => ({
  hour: t,
  wave: { height_ft: 3 + Math.sin(t / 12) * 1.5 },
  wind: { speed_mph: 8 + Math.cos(t / 8) * 4 },
  tide_ft: 2 + Math.sin(t / 6.2) * 1.8,
}));
const MOCK_STRIP_DATA = MOCK_TIMELINE.map(({ hour, wave }) => ({ t: hour, value: wave.height_ft }));
const MOCK_DAILY_RATINGS = [3, 4, 5, 4, 3, 2, 2];

const THEMES = ['ocean', 'dawn', 'daylight'];

function PrimitiveBlock({ title, children }) {
  return (
    <section style={{ marginBottom: 32, padding: '16px 20px', background: 'var(--bg-2)', borderRadius: 'var(--radius-m)', border: '1px solid var(--border)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </section>
  );
}

export default function DevPrimitives() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', padding: '32px 24px', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>Dev harness</div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>components/spot/ primitives</h1>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {THEMES.map(t => (
              <button key={t} onClick={() => setTheme(t)}
                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', border: '1px solid var(--border)', background: theme === t ? 'var(--accent)' : 'var(--bg-3)', color: theme === t ? 'var(--bg)' : 'var(--fg)' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <PrimitiveBlock title="Compass — variant=default size=520">
          <Compass swells={MOCK_SWELLS} wind={MOCK_WIND} size={520} />
        </PrimitiveBlock>

        <PrimitiveBlock title="Compass — variant=mini size=200">
          <Compass swells={MOCK_SWELLS} wind={MOCK_WIND} size={200} variant="mini" />
        </PrimitiveBlock>

        <PrimitiveBlock title="SwellRow — primary swell">
          <SwellRow {...MOCK_SWELLS[0]} />
        </PrimitiveBlock>

        <PrimitiveBlock title="SwellBreakdown — 3 swells detected">
          <SwellBreakdown swells={MOCK_SWELLS} detectedCount={3} />
        </PrimitiveBlock>

        <PrimitiveBlock title="ConditionsGrid — showTabs=true">
          <ConditionsGrid conditions={MOCK_CONDITIONS} showTabs />
        </PrimitiveBlock>

        <PrimitiveBlock title="ConditionsGrid — showTabs=false (Copilot)">
          <ConditionsGrid conditions={MOCK_CONDITIONS} showTabs={false} />
        </PrimitiveBlock>

        <PrimitiveBlock title="StripChart — wave height, 168h">
          <StripChart data={MOCK_STRIP_DATA} valueKey="wave_height_ft" color="var(--s1)" height={48} cursorHour={24} />
        </PrimitiveBlock>

        <PrimitiveBlock title="StripChartStack — wave + wind + tide">
          <StripChartStack data={MOCK_TIMELINE} cursorHour={24} />
        </PrimitiveBlock>

        <PrimitiveBlock title="DayPicker">
          <DayPicker startDate={new Date()} selectedHour={12} dailyRatings={MOCK_DAILY_RATINGS} onSelectDay={() => {}} />
        </PrimitiveBlock>

        <PrimitiveBlock title="ForecastScrubber — 168h">
          <ForecastScrubber totalHours={168} selectedHour={24} onChange={() => {}} miniChartData={MOCK_STRIP_DATA} startDate={new Date()} />
        </PrimitiveBlock>

        <PrimitiveBlock title="SpotTitle">
          <SpotTitle name="Cardiff Reef" eyebrow="SEASIDE · CARDIFF, CA" category={3} />
        </PrimitiveBlock>

        <PrimitiveBlock title="BreakFacts">
          <BreakFacts breakType="Reef break · Right + Left" bestDirection="NW-WNW 270–320°" bestTide="Mid 2–4ft" hazards="Urchins, shallow at low" />
        </PrimitiveBlock>

        <PrimitiveBlock title="SessionInsightCard — slug=cardiff-reef">
          <SessionInsightCard slug="cardiff-reef" />
        </PrimitiveBlock>
      </div>
    </div>
  );
}
