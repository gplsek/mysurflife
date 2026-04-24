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
            <div className="sd-tabs" style={{ padding: '3px' }}>
              {Object.entries(analyses).map(([key, a]) => (
                <button
                  key={key}
                  className={`sd-tab${activeTab === key ? ' on' : ''}`}
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
                  {generating ? <LogoPulse size={12} compact continuous /> : 'Regenerate'}
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
            ? 'No analysis yet — use the buttons above to generate.'
            : 'Analysis not yet available for this spot.'}
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
              <div className="sd-ai-facts-3">
                <div className="sd-fact">
                  <div className="sd-fact-k">Direction</div>
                  <div className="sd-fact-v">
                    {d.optimal_swell.direction_name}
                    {d.optimal_swell.direction_deg != null && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> {d.optimal_swell.direction_deg}°</span>
                    )}
                  </div>
                </div>
                <div className="sd-fact">
                  <div className="sd-fact-k">Period</div>
                  <div className="sd-fact-v">{d.optimal_swell.period_range}</div>
                </div>
                <div className="sd-fact">
                  <div className="sd-fact-k">Size</div>
                  <div className="sd-fact-v">{d.optimal_swell.size_range}</div>
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
              <div className="sd-ai-rows">
                {d.primary_windows.map((w, i) => (
                  <div key={i} className="sd-ai-row">
                    <div className="sd-ai-row-dot" style={{ background: qualityColor(w.quality) }} />
                    <div className="sd-ai-row-body">
                      <div className="sd-ai-row-head">
                        <span className="sd-ai-row-dir">{w.direction}</span>
                        {w.degrees && <span className="sd-ai-row-tag">{w.degrees}</span>}
                        {w.quality && (
                          <span className="sd-ai-row-quality" style={{ color: qualityColor(w.quality) }}>
                            {w.quality}
                          </span>
                        )}
                      </div>
                      {w.notes && <p className="sd-ai-row-note">{w.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shadow zones */}
          {d.shadow_zones?.length > 0 && (
            <div className="sd-ai-block">
              <div className="sd-ai-block-label">Shadow Zones</div>
              <div className="sd-ai-rows">
                {d.shadow_zones.map((z, i) => (
                  <div key={i} className="sd-ai-row">
                    <div className="sd-ai-row-dot" style={{ background: 'var(--muted)', opacity: 0.5 }} />
                    <div className="sd-ai-row-body">
                      <div className="sd-ai-row-head">
                        <span className="sd-ai-row-dir">{z.direction}</span>
                        {z.degrees   && <span className="sd-ai-row-tag">{z.degrees}</span>}
                        {z.blockage  && <span className="sd-ai-row-tag">{z.blockage} blocked</span>}
                      </div>
                      {z.blocker && <p className="sd-ai-row-note">{z.blocker}</p>}
                      {z.notes   && <p className="sd-ai-row-note">{z.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bathymetry */}
          {d.bathymetry && (
            <div className="sd-ai-block">
              <div className="sd-ai-block-label">Bathymetry</div>
              {d.bathymetry.notes && <p className="sd-ai-note">{d.bathymetry.notes}</p>}
              <div className="sd-ai-facts-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {d.bathymetry.depth_characteristics && (
                  <div className="sd-fact">
                    <div className="sd-fact-k">Depth</div>
                    <div className="sd-fact-v" style={{ fontSize: 12, fontWeight: 500 }}>{d.bathymetry.depth_characteristics}</div>
                  </div>
                )}
                {d.bathymetry.refraction_effects && (
                  <div className="sd-fact">
                    <div className="sd-fact-k">Refraction</div>
                    <div className="sd-fact-v" style={{ fontSize: 12, fontWeight: 500 }}>{d.bathymetry.refraction_effects}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metadata footer */}
          <p className="sd-ai-meta">
            {current.provider} · {current.model_display} · {new Date(current.created_at).toLocaleDateString()}
          </p>
        </div>
      )}

      {error && <p className="sd-ai-error">{error}</p>}
    </div>
  );
};

export default AISpotAnalysis;
