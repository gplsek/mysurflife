# 🔌 AI Spot Analysis - Integration Example

## Quick Integration into Existing Buoy Detail Panel

This guide shows how to add the AI Spot Analysis button to your existing buoy detail panel in `MapOverlay.js` or `SpotDetail.js`.

---

## Option 1: Modal Overlay (Recommended)

Add AI analysis as a modal overlay on top of the map.

### Step 1: Import Component

```javascript
// At top of MapOverlay.js or SpotDetail.js
import AISpotAnalysis from './AISpotAnalysis';
import './AISpotAnalysis.css';
```

### Step 2: Add State

```javascript
// Add to your component state (inside MapOverlay or SpotDetail)
const [showAIAnalysis, setShowAIAnalysis] = useState(false);
const [aiAnalysisBuoy, setAIAnalysisBuoy] = useState(null);
```

### Step 3: Add Button to Buoy Detail Panel

Find where you render buoy details (likely in the buoy info panel), and add:

```javascript
{/* Add this button near other buoy actions */}
<button
  className="ai-analysis-trigger"
  onClick={() => {
    setAIAnalysisBuoy({
      id: selectedBuoy.id,
      name: selectedBuoy.name
    });
    setShowAIAnalysis(true);
  }}
>
  🤖 AI Spot Analysis
</button>
```

### Step 4: Render Modal

Add this at the end of your component's return statement (after the map container):

```javascript
{/* AI Analysis Modal Overlay */}
{showAIAnalysis && aiAnalysisBuoy && (
  <div className="ai-modal-overlay" onClick={() => setShowAIAnalysis(false)}>
    <div className="ai-modal-content" onClick={(e) => e.stopPropagation()}>
      <AISpotAnalysis
        buoyId={aiAnalysisBuoy.id}
        spotName={aiAnalysisBuoy.name}
        onClose={() => setShowAIAnalysis(false)}
      />
    </div>
  </div>
)}
```

### Step 5: Add Modal Styles

Add to your CSS file (or create `AIModal.css`):

```css
/* AI Modal Overlay */
.ai-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.ai-modal-content {
  max-width: 700px;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.ai-analysis-trigger {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s;
  margin-top: 10px;
  width: 100%;
}

.ai-analysis-trigger:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}
```

---

## Option 2: Expandable Section (In-Panel)

Show AI analysis as an expandable section within the buoy detail panel.

### Implementation:

```javascript
// In your buoy detail panel component
const [aiSectionExpanded, setAISectionExpanded] = useState(false);

return (
  <div className="buoy-detail-panel">
    {/* Existing buoy info */}
    <h2>{buoyData.name}</h2>
    <div className="buoy-metrics">
      {/* Wave height, period, etc. */}
    </div>

    {/* AI Analysis Section */}
    <div className="buoy-section ai-section-wrapper">
      <button
        className="section-toggle"
        onClick={() => setAISectionExpanded(!aiSectionExpanded)}
      >
        <span className="section-icon">🤖</span>
        <span className="section-title">AI Spot Analysis</span>
        <span className="section-arrow">{aiSectionExpanded ? '▼' : '▶'}</span>
      </button>

      {aiSectionExpanded && (
        <div className="section-content">
          <AISpotAnalysis
            buoyId={buoyData.id}
            spotName={buoyData.name}
            onClose={null} // No close button needed in expandable
          />
        </div>
      )}
    </div>

    {/* Existing historical charts, etc. */}
  </div>
);
```

### Styling:

```css
.ai-section-wrapper {
  margin-top: 15px;
  border-top: 1px solid #e5e7eb;
}

.section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
}

.section-toggle:hover {
  background: #f9fafb;
}

.section-icon {
  font-size: 20px;
}

.section-title {
  flex: 1;
  text-align: left;
  font-weight: 600;
  font-size: 15px;
  color: #1f2937;
}

.section-arrow {
  color: #6b7280;
  font-size: 12px;
}

.section-content {
  padding: 0;
  background: #f9fafb;
}
```

---

## Option 3: Dedicated Tab

If you have a tabbed interface in buoy details:

```javascript
const [activeTab, setActiveTab] = useState('overview');

const tabs = ['overview', 'history', 'forecast', 'ai-analysis'];

return (
  <div className="buoy-detail-panel">
    {/* Tab navigation */}
    <div className="tabs">
      {tabs.map(tab => (
        <button
          key={tab}
          className={activeTab === tab ? 'active' : ''}
          onClick={() => setActiveTab(tab)}
        >
          {tab === 'ai-analysis' && '🤖 '}
          {tab.replace('-', ' ').toUpperCase()}
        </button>
      ))}
    </div>

    {/* Tab content */}
    <div className="tab-content">
      {activeTab === 'overview' && <BuoyOverview {...buoyData} />}
      {activeTab === 'history' && <BuoyHistory {...buoyData} />}
      {activeTab === 'forecast' && <BuoyForecast {...buoyData} />}
      {activeTab === 'ai-analysis' && (
        <AISpotAnalysis
          buoyId={buoyData.id}
          spotName={buoyData.name}
          onClose={null}
        />
      )}
    </div>
  </div>
);
```

---

## Minimal Working Example

If you just want to test it quickly:

```javascript
import React, { useState } from 'react';
import AISpotAnalysis from './AISpotAnalysis';

function QuickTest() {
  return (
    <div style={{ padding: '20px' }}>
      <AISpotAnalysis
        buoyId="46266"
        spotName="Del Mar Nearshore"
        onClose={null}
      />
    </div>
  );
}

export default QuickTest;
```

Then add to your routes:
```javascript
<Route path="/test-ai" component={QuickTest} />
```

Visit: http://localhost:3000/test-ai

---

## Complete Integration Checklist

### Backend:
- [x] Add `ANTHROPIC_API_KEY` to `.env`
- [x] Install dependencies (`pip install -r requirements.txt`)
- [x] Run database migration
- [x] Restart backend
- [x] Verify "✅ AI personas module loaded" in logs

### Frontend:
- [ ] Copy `AISpotAnalysis.js` to `frontend/src/`
- [ ] Copy `AISpotAnalysis.css` to `frontend/src/`
- [ ] Import component in your buoy detail file
- [ ] Add state for AI modal/section
- [ ] Add trigger button
- [ ] Add modal/section rendering
- [ ] Test with a buoy (generate analysis)

### Testing:
- [ ] Click AI button → modal/section opens
- [ ] Click "Generate AI Analysis" → wait ~10-15 seconds
- [ ] Verify analysis displays correctly
- [ ] Close and reopen → should load from cache instantly
- [ ] Test regenerate button (force refresh)

---

## Example: Integrating into MapOverlay.js

Assuming you have a buoy detail panel in `MapOverlay.js`:

```javascript
// At top of file
import AISpotAnalysis from './AISpotAnalysis';

// In your component
const [showAIAnalysis, setShowAIAnalysis] = useState(false);

// In your buoy detail panel JSX (find where you render buoy info)
{selectedBuoy && (
  <div className="buoy-detail-panel">
    <h3>{selectedBuoy.name}</h3>

    {/* Existing metrics */}
    <div className="metrics">...</div>

    {/* ADD THIS: AI Analysis Button */}
    <button
      className="ai-btn"
      onClick={() => setShowAIAnalysis(true)}
      style={{
        background: 'linear-gradient(135deg, #667eea, #764ba2)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        padding: '10px',
        marginTop: '15px',
        width: '100%',
        cursor: 'pointer',
        fontWeight: '600'
      }}
    >
      🤖 AI Spot Analysis
    </button>
  </div>
)}

{/* ADD THIS: AI Modal (at end of component return) */}
{showAIAnalysis && selectedBuoy && (
  <div
    style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}
    onClick={() => setShowAIAnalysis(false)}
  >
    <div onClick={(e) => e.stopPropagation()}>
      <AISpotAnalysis
        buoyId={selectedBuoy.id}
        spotName={selectedBuoy.name}
        onClose={() => setShowAIAnalysis(false)}
      />
    </div>
  </div>
)}
```

---

## Keyboard Shortcuts (Optional Enhancement)

```javascript
useEffect(() => {
  const handleKeyPress = (e) => {
    // Press 'A' to toggle AI analysis
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey && selectedBuoy) {
      setShowAIAnalysis(prev => !prev);
    }
    // Press 'Escape' to close
    if (e.key === 'Escape' && showAIAnalysis) {
      setShowAIAnalysis(false);
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, [selectedBuoy, showAIAnalysis]);
```

---

## Next Steps

1. **Choose integration option** (Modal, Expandable, or Tab)
2. **Copy files** to frontend/src/
3. **Add imports and state** to your buoy detail component
4. **Add trigger button** in buoy panel
5. **Add modal/section rendering**
6. **Test with one buoy** first
7. **Generate analyses for all buoys** once working

---

**That's it!** The AI Spot Analysis is now integrated into your surf forecasting app. Users can click the AI button on any buoy to get expert oceanographic analysis of the spot's optimal swell conditions.