import React from 'react';
import StripChart from './StripChart';

export default function StripChartStack({ data = [], cursorHour = 0, tracks = ['wave', 'wind', 'tide'] }) {
  if (data.length === 0) {
    return (
      <div className="sd-strip-stack">
        {tracks.map(id => (
          <div key={id} className="sd-strip-row">
            <div className="sd-strip-label">
              <span className="sd-strip-label-k">{id.charAt(0).toUpperCase() + id.slice(1)}</span>
            </div>
            <div className="sd-strip-chart">
              <div className="sd-strip-skeleton" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const waveData = data.map(p => ({ t: p.hour, value: p.wave?.height_ft || 0 }));
  const windData = data.map(p => ({ t: p.hour, value: p.wind?.speed_mph || 0 }));

  const minTide = Math.min(...data.map(p => p.tide_ft ?? 0));
  const tideData = data.map(p => ({ t: p.hour, value: (p.tide_ft ?? minTide) - minTide }));

  const trackDefs = [
    { id: 'wave', label: 'Wave', unit: 'ft', data: waveData, color: 'var(--s1)' },
    { id: 'wind', label: 'Wind', unit: 'mph', data: windData, color: 'var(--wind)' },
    { id: 'tide', label: 'Tide', unit: 'ft', data: tideData, color: 'var(--muted)' },
  ].filter(t => tracks.includes(t.id));

  return (
    <div className="sd-strip-stack">
      {trackDefs.map(track => (
        <div key={track.id} className="sd-strip-row">
          <div className="sd-strip-label">
            <span className="sd-strip-label-k">{track.label}</span>
            <span className="sd-strip-label-u">{track.unit}</span>
          </div>
          <div className="sd-strip-chart">
            <StripChart
              data={track.data}
              valueKey={track.label}
              color={track.color}
              height={38}
              cursorHour={cursorHour}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
