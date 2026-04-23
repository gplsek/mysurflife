import React from 'react';
import { ArrivalRow } from './ArrivalRow';

export function ArrivalSpotList({ region, highlight, onHighlight, stormId }) {
  if (!region) return null;

  const spots   = region.spots || [];
  const hasMore = (region.total_spots || 0) > spots.length;

  return (
    <div className="l3-section">
      <div className="l3-head">
        <span>
          <b>{region.name}</b> · {spots.length} spots in range
        </span>
        <span className="l3-sorted">sorted by score</span>
      </div>

      <div className="l3-spots">
        {spots.map(spot => (
          <ArrivalRow
            key={spot.id}
            spot={spot}
            highlight={highlight}
            stormId={stormId}
            regionId={region.region_id}
          />
        ))}
      </div>

      {hasMore && (
        <button className="see-all">
          See all {region.total_spots} spots
        </button>
      )}
    </div>
  );
}
