import React from 'react';
import { RegionChips }       from './RegionChips';
import { LeftRail }          from './LeftRail';
import { ZoomControls }      from './ZoomControls';
import { PreviewCard }       from './PreviewCard';
import { StormPreviewCard }  from './StormPreviewCard';
import { StatusBar }         from './StatusBar';
import { ratingTier }        from './markers';
import { TIER_LEGEND }       from './constants';

export default function Chrome({
  mapRef,
  state,
  onRegion,
  onToggle,
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
  stormPreview,
  onStormPreviewClose,
  onStormOpenDetail,
}) {
  const tierCounts = TIER_LEGEND.reduce((acc, { tier }) => {
    acc[tier] = spots.filter(sp => ratingTier(sp.current_conditions?.overall_score) === tier).length;
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
        loading={loading}
      />
      <ZoomControls mapRef={mapRef} />
      <PreviewCard preview={preview} isFav={isFav} onToggleFav={onToggleFav} onClose={onPreviewClose} />
      {stormPreview && (
        <StormPreviewCard
          storm={stormPreview}
          onClose={onStormPreviewClose}
          onOpenDetail={onStormOpenDetail}
        />
      )}
      <StatusBar
        loading={loading}
        inViewCount={inViewCount}
        totalCount={spots.length}
        updatedAt={updatedAt}
      />
    </>
  );
}
