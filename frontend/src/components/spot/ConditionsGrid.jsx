import { useState } from 'react';

/**
 * <ConditionsGrid>
 * 6-cell grid: Wave face, Dom. period, Primary dir, Wind, Tide, Water temp.
 * Optional Wave/Wind/Tide/All tabs.
 */
export default function ConditionsGrid({
  conditions = null,
  showTabs = true,
  activeTab: activeTabProp = 'wave',
  onTabChange = null,
  title = 'Current Conditions',
  subtitle = 'Live + model data',
}) {
  const [internalTab, setInternalTab] = useState('wave');
  const activeTab = onTabChange ? activeTabProp : internalTab;

  const handleTabClick = (tab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  const TABS = [
    { id: 'wave', label: 'Wave' },
    { id: 'wind', label: 'Wind' },
    { id: 'tide', label: 'Tide' },
    { id: 'all',  label: 'All'  },
  ];

  const tideSubtitle = conditions?.tide_position
    ? conditions.tide_position +
      (conditions.tide_trend === 'rising' ? ' ↑' : conditions.tide_trend === 'falling' ? ' ↓' : '')
    : '--';

  return (
    <>
      <div className="sd-cond-head">
        <div>
          <div className="sd-card-title">{title}</div>
          <div className="sd-card-sub">{subtitle}</div>
        </div>
        {showTabs && (
          <div className="sd-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`sd-tab${activeTab === t.id ? ' on' : ''}`}
                onClick={() => handleTabClick(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sd-cond-grid">
        {/* 1. Wave face */}
        <div className="sd-cond">
          <div className="sd-cond-k">Wave Face</div>
          <div className="sd-cond-v">
            {conditions?.wave_face_ft?.toFixed(1) || '--'}
            <span className="sd-cond-u">ft</span>
          </div>
          <div className="sd-cond-s">{conditions?.category_label || ''}</div>
        </div>

        {/* 2. Dom. period */}
        <div className="sd-cond">
          <div className="sd-cond-k">Dom. Period</div>
          <div className="sd-cond-v">
            {conditions?.period_s ? Math.round(conditions.period_s) : '--'}
            <span className="sd-cond-u">s</span>
          </div>
          <div className="sd-cond-s">{conditions?.period_label || ''}</div>
        </div>

        {/* 3. Primary dir */}
        <div className="sd-cond">
          <div className="sd-cond-k">Primary Dir</div>
          <div className="sd-cond-v">
            {conditions?.primary_dir_deg ? Math.round(conditions.primary_dir_deg) : '--'}
            <span className="sd-cond-u">°</span>
          </div>
          <div className="sd-cond-s">{conditions?.primary_dir_label || ''}</div>
        </div>

        {/* 4. Wind */}
        <div className="sd-cond">
          <div className="sd-cond-k">Wind</div>
          <div className="sd-cond-v">
            {conditions?.wind_mph ? Math.round(conditions.wind_mph) : '--'}
            <span className="sd-cond-u">mph</span>
          </div>
          <div className="sd-cond-s">{conditions?.wind_label || ''}</div>
        </div>

        {/* 5. Tide */}
        <div className="sd-cond">
          <div className="sd-cond-k">Tide</div>
          <div className="sd-cond-v">
            {conditions?.tide_ft?.toFixed(1) || '--'}
            <span className="sd-cond-u">ft</span>
          </div>
          <div className="sd-cond-s">{tideSubtitle}</div>
        </div>

        {/* 6. Water temp — buoy observation, always current regardless of scrubber */}
        <div className="sd-cond">
          <div className="sd-cond-k">Water</div>
          <div className="sd-cond-v">
            {conditions?.water_temp_f ? Math.round(conditions.water_temp_f) : '--'}
            <span className="sd-cond-u">°F</span>
          </div>
          <div className="sd-cond-s">
            {conditions?.water_temp_f
              ? `Current${conditions.wetsuit ? ` · ${conditions.wetsuit}` : ''}`
              : conditions?.wetsuit || ''}
          </div>
        </div>
      </div>
    </>
  );
}
