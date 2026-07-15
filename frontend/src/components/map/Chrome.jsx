import React from 'react';
import { RegionChips }       from './RegionChips';
import { LeftRail }          from './LeftRail';
import { ZoomControls }      from './ZoomControls';
import { PreviewCard }       from './PreviewCard';
import { BuoyPreviewCard }   from './BuoyPreviewCard';
import { StormPreviewCard }  from './StormPreviewCard';
import { StatusBar }         from './StatusBar';
import MapTimeline           from './MapTimeline';
import { ratingTier }        from './markers';
import { TIER_LEGEND }       from './constants';

export default function Chrome({
  mapRef,
  state,
  onRegion,
  onToggle,
  onStormStrength,
  spots,
  buoys,
  storms,
  loading,
  inViewCount,
  updatedAt,
  preview,
  isFav,
  onToggleFav,
  onPreviewClose,
  buoyPreview,
  onBuoyPreviewClose,
  stormPreview,
  onStormPreviewClose,
  onStormOpenDetail,
  addSpotMode,
  onAddSpotToggle,
  curH,
  onCurHChange,
  overlayBusy,
}) {
  const tierCounts = TIER_LEGEND.reduce((acc, { tier }) => {
    acc[tier] = spots.filter(sp => {
      const r = sp.rating ?? (sp.current_conditions?.overall_score != null
        ? sp.current_conditions.overall_score / 2 : null);
      return ratingTier(r) === tier;
    }).length;
    return acc;
  }, {});

  return (
    <>
      <RegionChips activeRegion={state.region} onRegion={onRegion} spots={spots} />
      <LeftRail
        tierCounts={tierCounts}
        buoyCount={buoys.length}
        stormCount={storms.length}
        state={state}
        onToggle={onToggle}
        onStormStrength={onStormStrength}
        loading={loading}
      />
      <ZoomControls mapRef={mapRef} addSpotMode={addSpotMode} onAddSpotToggle={onAddSpotToggle} />
      <PreviewCard preview={preview} isFav={isFav} onToggleFav={onToggleFav} onClose={onPreviewClose} />
      <BuoyPreviewCard buoy={buoyPreview} onClose={onBuoyPreviewClose} />
      {stormPreview && (
        <StormPreviewCard
          storm={stormPreview}
          onClose={onStormPreviewClose}
          onOpenDetail={onStormOpenDetail}
        />
      )}
      <MapTimeline
        curH={curH}
        onCurHChange={onCurHChange}
        busy={overlayBusy}
      />
      <StatusBar
        loading={loading}
        inViewCount={inViewCount}
        totalCount={spots.length}
        updatedAt={updatedAt}
      />
    </>
  );
}
