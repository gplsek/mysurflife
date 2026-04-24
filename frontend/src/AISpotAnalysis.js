import React, { useState, useEffect } from 'react';
import { getAuthHeaders } from './supabaseClient';
import LogoPulse from './design/LogoPulse';

const AISpotAnalysis = ({ spotSlug, spotName, isAdmin = false, isEditMode = false }) => {
  const [analyses,   setAnalyses]   = useState({});
  const [activeTab,  setActiveTab]  = useState('claude');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (spotSlug) fetchAllAnalyses();
  }, [spotSlug]);

  const fetchAllAnalyses = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/spots/${spotSlug}/ai-analysis/all`);
      const data = await res.json();
      if (data.success && data.analyses) {
        setAnalyses(data.analyses);
        if (data.available_models?.length > 0) setActiveTab(data.available_models[0]);
      } else {
        setAnalyses({});
      }
    } catch {
      setError('Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  const runGenerate = async (model, force = false) => {
    setGenerating(true);
    setError(null);
    try {
      const headers  = await getAuthHeaders();
      const endpoint = model === 'openai'
        ? `/api/spots/${spotSlug}/ai-analysis/generate-openai`
        : `/api/spots/${spotSlug}/ai-analysis/generate${force ? '?force=true' : ''}`;
      const res = await fetch(endpoint, { method: 'POST', headers });
      if (res.status === 401 || res.status === 403) { setError('Admin access required.'); return; }
      const data = await res.json();
      if (data.success) await fetchAllAnalyses();
      else setError(data.error || 'Generation failed');
    } catch {
      setError('Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const hasAnalyses = Object.keys(analyses).length > 0;
  const current     = analyses[activeTab];
  const d           = current?.analysis_data || {};

  const qualityColor = (q) =>
    q === 'Excellent' ? 'var(--good)'
    : q === 'Good'    ? 'var(--accent)'
    : q === 'Fair'    ? 'var(--gold)'
    : 'var(--muted)';

  return (
    <div className="sd-ai">
      {/* Header */}
      <div className="sd-ai-head">
        <span className="sd-card-title" style={{ fontSize: 14 }}>Sione's Analysis</span>
        <div className="sd-ai-head-actions">
          {hasAnalyses && Object.keys(analyses).length > 1 && (
            <div className="sd-ai-tabs">
              {Object.entries(analyses).map(([key, a]) => (
                <button
                  key={key}
                  className={`sd-ai-tab${activeTab === key ? ' active' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  {a.provider}
                </button>
              ))}
            </div>
          )}
          {isAdmin && isEditMode && (
            <div className="sd-ai-admin-btns">
              {hasAnalyses && (
                <button
                  className="sd-chip sd-chip--accent"
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={() => runGenerate(activeTab, true)}
                  disabled={generating}
                >
                  {generating
                    ? <LogoPulse size={12} compact continuous />
                    : 'Regenerate'}
                </button>
              )}
              {!analyses.claude && (
                <button
                  className="sd-chip"
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={() => runGenerate('claude')}
                  disabled={generating}
                >
                  {generating ? <LogoPulse size={12} compact continuous /> : '+ Claude'}
                </button>
              )}
              {!analyses.openai && (
                <button
                  className="sd-chip"
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={() => runGenerate('openai')}
                  disabled={generating}
                >
                  {generating ? <LogoPulse size={12} compact continuous /> : '+ OpenAI'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
          <LogoPulse size={24} compact />
        </div>
      ) : !hasAnalyses ? (
        <div className="sd-ai-empty">
          {isAdmin && isEditMode
            ? <span>No analysis yet — use the buttons above to generate.</span>
            : <span>Analysis not yet available for this spot.</span>}
        </div>
      ) : (
        <div className="sd-ai-body">

          {/* Summary */}
          {d.summary && (
            <p className="sd-ai-summary">{d.summary}</p>
          )}

          {/* Optimal conditions */}
          {d.optimal_swell && (
            <div className="sd-ai-block">
              <div className="sd-ai-block-label">Optimal Conditions</div>
              <div className="sd-ai-grid-3">
                <div className="sd-ai-cell">
                  <span className="sd-ai-k">Direction</span>
                  <span className="sd-ai-v">
                    {d.optimal_swell.direction_name}
                    {d.optimal_swell.direction_deg != null && (
                      <span className="sd-ai-u"> {d.optimal_swell.direction_deg}°</span>
                    )}
                  </span>
                </div>
                <div className="sd-ai-cell">
                  <span className="sd-ai-k">Period</span>
                  <span className="sd-ai-v">{d.optimal_swell.period_range}</span>
                </div>
                <div className="sd-ai-cell">
                  <span className="sd-ai-k">Size</span>
                  <span className="sd-ai-v">{d.optimal_swell.size_range}</span>
                </div>
              </div>
              {d.optimal_swell.season_notes && (
                <p className="sd-ai-note">{d.optimal_swell.season_notes}</p>
              )}
            </div>
          )}

          {/* Swell windows */}
          {d.primary_windows?.length > 0 && (
            <div className="sd-ai-block">
              <div className="sd-ai-block-label">Swell Windows</div>
              {d.primary_windows.map((w, i) => (
                <div key={i} className="sd-ai-window" style={{ '--quality-color': qualityColor(w.quality) }}>
                  <div className="sd-ai-window-head">
                    <span className="sd-ai-window-dir">{w.direction}</span>
                    {w.degrees && <span className="sd-ai-u">{w.degrees}</span>}
                    <span className="sd-ai-quality" style={{ color: qualityColor(w.quality) }}>{w.quality}</span>
                  </div>
                  {w.notes && <p className="sd-ai-note">{w.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Shadow zones */}
          {d.shadow_zones?.length > 0 && (
            <div className="sd-ai-block">
              <div className="sd-ai-block-label">Shadow Zones</div>
              {d.shadow_zones.map((z, i) => (
                <div key={i} className="sd-ai-window">
                  <div className="sd-ai-window-head">
                    <span className="sd-ai-window-dir">{z.direction}</span>
                    {z.degrees && <span className="sd-ai-u">{z.degrees}</span>}
                    <span className="sd-ai-u">{z.blockage} blocked</span>
                  </div>
                  {z.blocker && <p className="sd-ai-note">{z.blocker}</p>}
                  {z.notes   && <p className="sd-ai-note">{z.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Bathymetry */}
          {d.bathymetry && (
            <div className="sd-ai-block">
              <div className="sd-ai-block-label">Bathymetry</div>
              {d.bathymetry.notes && <p className="sd-ai-note">{d.bathymetry.notes}</p>}
              {d.bathymetry.depth_characteristics && (
                <div className="sd-ai-kv">
                  <span className="sd-ai-k">Depth</span>
                  <span className="sd-ai-v">{d.bathymetry.depth_characteristics}</span>
                </div>
              )}
              {d.bathymetry.refraction_effects && (
                <div className="sd-ai-kv">
                  <span className="sd-ai-k">Refraction</span>
                  <span className="sd-ai-v">{d.bathymetry.refraction_effects}</span>
                </div>
              )}
            </div>
          )}

          {/* Metadata */}
          <p className="sd-ai-meta">
            {current.provider} {current.model_display} · {new Date(current.created_at).toLocaleDateString()}
          </p>
        </div>
      )}

      {error && <p className="sd-ai-error">{error}</p>}
    </div>
  );
};

export default AISpotAnalysis;
