import React from 'react';
import LogoPulse from '../../design/LogoPulse';

export default function SessionInsightCard({ slug }) {
  return (
    <div className="sd-insight-card">
      <div className="sd-insight-head">
        <span className="sd-card-title">AI Insight</span>
        <span className="sd-insight-badge">
          <LogoPulse size={12} />
          Coming soon
        </span>
      </div>
      <div className="sd-insight-empty">
        <div className="sd-insight-icon">
          <LogoPulse size={48} />
        </div>
        <p className="sd-insight-msg">
          Log sessions at this spot to unlock personalized AI insights — preferred conditions, best windows, and performance trends.
        </p>
        <button className="sd-insight-cta">Log a session</button>
      </div>
    </div>
  );
}
