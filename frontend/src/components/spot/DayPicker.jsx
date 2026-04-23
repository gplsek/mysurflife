import { useState, useEffect, useRef } from 'react';

/**
 * <DayPicker>
 * Pill dropdown showing the currently selected day + time.
 * Expands to a 7-day list with daily ratings (0–5 filled squares).
 */
export default function DayPicker({
  startDate,
  selectedHour = 0,
  dailyRatings = [],
  onSelectDay,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const currentDayIdx = Math.floor(selectedHour / 24);
  const hourInDay = selectedHour % 24;

  const formatPillText = () => {
    if (!startDate) return selectedHour === 0 ? 'Today' : `+${selectedHour}h`;
    const date = new Date(startDate);
    date.setHours(date.getHours() + selectedHour);
    const h12 = date.getHours() % 12 || 12;
    const mm = date.getMinutes().toString().padStart(2, '0');
    const ap = date.getHours() >= 12 ? 'PM' : 'AM';
    const timeStr = `${h12}:${mm} ${ap}`;

    if (currentDayIdx === 0) return `Today · +${selectedHour}h · ${timeStr}`;
    if (currentDayIdx === 1) return `Tomorrow · +${selectedHour}h · ${timeStr}`;
    return `${DAY_NAMES[getDayOfWeek(currentDayIdx)]} · +${selectedHour}h · ${timeStr}`;
  };

  const getDayOfWeek = (dayOffset) => {
    if (!startDate) return dayOffset % 7;
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayOffset);
    return d.getDay();
  };

  const getDayLabel = (dayIdx) => {
    if (dayIdx === 0) return 'Today';
    if (dayIdx === 1) return 'Tomorrow';
    return DAY_NAMES[getDayOfWeek(dayIdx)];
  };

  const getDayDate = (dayIdx) => {
    if (!startDate) return '';
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayIdx);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };

  const getDowLabel = (dayIdx) => {
    return DOW_SHORT[getDayOfWeek(dayIdx)];
  };

  return (
    <div className="sd-day-picker" ref={ref}>
      <button
        className="sd-pill-btn"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {/* Clock icon */}
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>{formatPillText()}</span>
        {/* Chevron */}
        <svg
          className="sd-chev"
          width={12} height={12} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className={`sd-day-menu${open ? ' open' : ''}`} role="listbox">
        {Array.from({ length: 7 }, (_, dayIdx) => {
          const rating = dailyRatings[dayIdx] ?? 2;
          const isSelected = dayIdx === currentDayIdx;
          return (
            <button
              key={dayIdx}
              className={`sd-day-opt${isSelected ? ' on' : ''}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onSelectDay?.(dayIdx);
                setOpen(false);
              }}
            >
              <span className="sd-dow">{getDowLabel(dayIdx)}</span>
              <span className="sd-day-opt-label">
                <span className="sd-day-label-name">{getDayLabel(dayIdx)}</span>
                {getDayDate(dayIdx) && (
                  <span className="sd-day-label-date">{getDayDate(dayIdx)}</span>
                )}
              </span>
              <span className="sd-rating">
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className="sd-rating-sq"
                    style={{ background: i < rating ? 'var(--s1)' : 'rgba(255,255,255,0.08)' }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
