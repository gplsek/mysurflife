/**
 * <SpotTitle>
 * Eyebrow tag + spot name heading.
 * No absolute positioning — parent SpotDetail handles placement.
 */
export default function SpotTitle({ name = '', eyebrow = '', category = null }) {
  return (
    <div className="sd-spot-title-content">
      {eyebrow && <span className="sd-title-tag">{eyebrow}</span>}
      <span className="sd-title-name">{name}</span>
    </div>
  );
}
