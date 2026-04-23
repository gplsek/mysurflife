/**
 * <BreakFacts>
 * 4-cell static facts row: Break type, Best direction, Best tide, Hazards.
 */
export default function BreakFacts({ breakType = '', bestDirection = '', bestTide = '', hazards = '' }) {
  const facts = [
    { k: 'Break Type',      v: breakType || '—' },
    { k: 'Best Direction',  v: bestDirection || '—' },
    { k: 'Best Tide',       v: bestTide || '—' },
    { k: 'Hazards',         v: hazards || '—' },
  ];

  return (
    <div className="sd-facts">
      {facts.map(({ k, v }) => (
        <div key={k} className="sd-fact">
          <div className="sd-fact-k">{k}</div>
          <div className="sd-fact-v">{v}</div>
        </div>
      ))}
    </div>
  );
}
