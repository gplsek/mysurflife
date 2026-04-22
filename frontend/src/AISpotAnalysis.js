import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getAuthHeaders } from './supabaseClient';
import LogoPulse from './design/LogoPulse';
import './AISpotAnalysis.css';

/**
 * AI Spot Analysis Component - For SURF SPOTS
 *
 * Displays AI-powered swell geometry analysis for specific surf spots.
 * Shows optimal swell directions, shadow zones, break-specific recommendations.
 *
 * Props:
 * - spotSlug: The spot's URL slug (e.g., "blacks-beach")
 * - spotName: Display name (e.g., "Blacks Beach")
 * - onClose: Optional close handler for modal usage
 */
const AISpotAnalysis = ({ spotSlug, spotName, onClose }) => {
  const { isAdmin, loading: authLoading } = useAuth();
  const [analyses, setAnalyses] = useState({}); // All analyses by model
  const [activeTab, setActiveTab] = useState('claude'); // Default to Claude
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  // Fetch all analyses on mount
  useEffect(() => {
    if (spotSlug) {
      fetchAllAnalyses();
    }
  }, [spotSlug]);

  const fetchAllAnalyses = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/spots/${spotSlug}/ai-analysis/all`);
      const data = await response.json();

      if (data.success && data.analyses) {
        setAnalyses(data.analyses);

        // Set active tab to first available analysis
        if (data.available_models && data.available_models.length > 0) {
          setActiveTab(data.available_models[0]);
        }
      } else {
        // No cached analyses - show generate button
        setAnalyses({});
      }
    } catch (err) {
      console.error('Error fetching AI analyses:', err);
      setError('Failed to load analyses');
    } finally {
      setLoading(false);
    }
  };

  const generateAnalysis = async (model = 'claude') => {
    setGenerating(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const endpoint = model === 'openai'
        ? `/api/spots/${spotSlug}/ai-analysis/generate-openai`
        : `/api/spots/${spotSlug}/ai-analysis/generate`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers
      });

      if (response.status === 401 || response.status === 403) {
        setError('Authentication required. Please sign in as admin.');
        setGenerating(false);
        return;
      }

      const data = await response.json();

      if (data.success) {
        // Refresh all analyses
        await fetchAllAnalyses();
      } else {
        setError(data.error || 'Failed to generate analysis');
      }
    } catch (err) {
      console.error('Error generating AI analysis:', err);
      setError('Failed to generate analysis');
    } finally {
      setGenerating(false);
    }
  };

  const regenerateAnalysis = async (model = 'claude') => {
    setGenerating(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const endpoint = model === 'openai'
        ? `/api/spots/${spotSlug}/ai-analysis/generate-openai`
        : `/api/spots/${spotSlug}/ai-analysis/generate?force=true`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers
      });

      if (response.status === 401 || response.status === 403) {
        setError('Authentication required. Please sign in as admin.');
        setGenerating(false);
        return;
      }

      const data = await response.json();

      if (data.success) {
        // Refresh all analyses
        await fetchAllAnalyses();
      } else {
        setError(data.error || 'Failed to regenerate analysis');
      }
    } catch (err) {
      console.error('Error regenerating AI analysis:', err);
      setError('Failed to regenerate analysis');
    } finally {
      setGenerating(false);
    }
  };

  const getQualityColor = (quality) => {
    const colors = {
      'Excellent': '#10b981',
      'Good': '#3b82f6',
      'Fair': '#f59e0b'
    };
    return colors[quality] || '#6b7280';
  };

  // Loading state
  if (loading) {
    return (
      <div className="ai-analysis-container">
        <div className="ai-analysis-header">
          <h3>🤖 AI Spot Analysis</h3>
          {onClose && <button onClick={onClose} className="close-btn">✕</button>}
        </div>
        <div className="ai-analysis-loading" style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
          <LogoPulse size={48} />
        </div>
      </div>
    );
  }

  // No analysis state - show generate buttons (admin only)
  if (Object.keys(analyses).length === 0) {
    return (
      <div className="ai-analysis-container">
        <div className="ai-analysis-header">
          <h3>🤖 AI Spot Analysis</h3>
          {onClose && <button onClick={onClose} className="close-btn">✕</button>}
        </div>
        <div className="ai-analysis-empty">
          <p>Get AI-powered swell geometry analysis for {spotName}.</p>
          <p className="ai-description">
            Expert oceanographic analysis of optimal swell directions, shadow zones,
            and wave behavior at this location.
          </p>
          {isAdmin ? (
            <div className="generate-buttons">
              <button
                onClick={() => generateAnalysis('claude')}
                disabled={generating}
                className="generate-btn"
              >
                {generating ? '🔄 Generating...' : '🤖 Generate Claude Analysis'}
              </button>
              <button
                onClick={() => generateAnalysis('openai')}
                disabled={generating}
                className="generate-btn generate-btn-secondary"
              >
                {generating ? '🔄 Generating...' : '🤖 Generate OpenAI Analysis'}
              </button>
            </div>
          ) : (
            !authLoading && (
              <p className="auth-note">
                Admin access required to generate analysis.
              </p>
            )
          )}
          {error && <p className="error-message">{error}</p>}
        </div>
      </div>
    );
  }

  const currentAnalysis = analyses[activeTab];
  const analysisData = currentAnalysis?.analysis_data || {};

  return (
    <div className="ai-analysis-container">
      <div className="ai-analysis-header">
        <h3>🤖 AI Spot Analysis</h3>
        <div className="header-actions">
          {isAdmin && (
            <button
              onClick={() => regenerateAnalysis(activeTab)}
              disabled={generating}
              className="regenerate-btn"
              title="Regenerate analysis"
            >
              {generating ? '🔄' : '♻️'}
            </button>
          )}
          {onClose && <button onClick={onClose} className="close-btn">✕</button>}
        </div>
      </div>

      {/* Model Tabs */}
      {Object.keys(analyses).length > 1 && (
        <div className="ai-model-tabs">
          {Object.entries(analyses).map(([key, data]) => (
            <button
              key={key}
              className={`model-tab ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              {data.provider} {data.model_display}
            </button>
          ))}
        </div>
      )}

      {/* Generate Missing Models (Admin Only) */}
      {isAdmin && (
        <div className="missing-models">
          {!analyses.claude && (
            <button
              onClick={() => generateAnalysis('claude')}
              disabled={generating}
              className="generate-model-btn"
            >
              + Add Claude Analysis
            </button>
          )}
          {!analyses.openai && (
            <button
              onClick={() => generateAnalysis('openai')}
              disabled={generating}
              className="generate-model-btn"
            >
              + Add OpenAI Analysis
            </button>
          )}
        </div>
      )}

      <div className="ai-analysis-content">
        {/* Summary */}
        {analysisData.summary && (
          <div className="ai-section summary-section">
            <p className="summary-text">{analysisData.summary}</p>
          </div>
        )}

        {/* Optimal Swell */}
        {analysisData.optimal_swell && (
          <div className="ai-section optimal-swell-section">
            <h4>🎯 Optimal Conditions</h4>
            <div className="optimal-swell-grid">
              <div className="optimal-item">
                <span className="label">Direction</span>
                <span className="value">
                  {analysisData.optimal_swell.direction_name} ({analysisData.optimal_swell.direction_deg}°)
                </span>
              </div>
              <div className="optimal-item">
                <span className="label">Period</span>
                <span className="value">{analysisData.optimal_swell.period_range}</span>
              </div>
              <div className="optimal-item">
                <span className="label">Size</span>
                <span className="value">{analysisData.optimal_swell.size_range}</span>
              </div>
            </div>
            {analysisData.optimal_swell.season_notes && (
              <p className="season-notes">{analysisData.optimal_swell.season_notes}</p>
            )}
          </div>
        )}

        {/* Primary Swell Windows */}
        {analysisData.primary_windows && analysisData.primary_windows.length > 0 && (
          <div className="ai-section windows-section">
            <h4>🌊 Swell Windows</h4>
            {analysisData.primary_windows.map((window, idx) => (
              <div key={idx} className="swell-window" style={{ borderLeftColor: getQualityColor(window.quality) }}>
                <div className="window-header">
                  <span className="direction">{window.direction}</span>
                  <span className="degrees">({window.degrees})</span>
                  <span className={`quality quality-${window.quality.toLowerCase()}`}>
                    {window.quality}
                  </span>
                </div>
                <p className="window-notes">{window.notes}</p>
              </div>
            ))}
          </div>
        )}

        {/* Shadow Zones */}
        {analysisData.shadow_zones && analysisData.shadow_zones.length > 0 && (
          <div className="ai-section shadows-section">
            <h4>⛔ Shadow Zones</h4>
            {analysisData.shadow_zones.map((zone, idx) => (
              <div key={idx} className="shadow-zone">
                <div className="shadow-header">
                  <span className="direction">{zone.direction}</span>
                  <span className="degrees">({zone.degrees})</span>
                  <span className="blockage">{zone.blockage} blocked</span>
                </div>
                <p className="blocker">🏝️ {zone.blocker}</p>
                {zone.notes && <p className="shadow-notes">{zone.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Partial Blockage */}
        {analysisData.partial_blockage && analysisData.partial_blockage.length > 0 && (
          <div className="ai-section partial-section">
            <h4>〰️ Partial Blockage</h4>
            {analysisData.partial_blockage.map((partial, idx) => (
              <div key={idx} className="partial-blockage">
                <div className="partial-header">
                  <span className="direction">{partial.direction}</span>
                  <span className="degrees">({partial.degrees})</span>
                  <span className="energy">{partial.energy_pct}% energy</span>
                </div>
                <p className="blocker">🌊 {partial.blocker}</p>
                <p className="threshold">Threshold: {partial.period_threshold}s period</p>
                {partial.notes && <p className="partial-notes">{partial.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Bathymetry */}
        {analysisData.bathymetry && (
          <div className="ai-section bathymetry-section">
            <h4>🗺️ Bathymetry & Refraction</h4>
            <p className="bathymetry-notes">{analysisData.bathymetry.notes}</p>
            {analysisData.bathymetry.depth_characteristics && (
              <div className="bathymetry-details">
                <span className="detail-label">Depth:</span>
                <span className="detail-value">{analysisData.bathymetry.depth_characteristics}</span>
              </div>
            )}
            {analysisData.bathymetry.refraction_effects && (
              <div className="bathymetry-details">
                <span className="detail-label">Refraction:</span>
                <span className="detail-value">{analysisData.bathymetry.refraction_effects}</span>
              </div>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="ai-metadata">
          <p>
            {currentAnalysis.provider} {currentAnalysis.model_display} •
            {currentAnalysis.model_used} •
            {new Date(currentAnalysis.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
    </div>
  );
};

export default AISpotAnalysis;