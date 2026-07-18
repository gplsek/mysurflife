import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useDraggable — drag-to-move for floating map cards.
 *
 * Returns:
 *   dragStyle       — spread onto the card root. Exposes the offset as
 *                     --drag-x/--drag-y CSS vars so the card's own transform
 *                     (e.g. translateX(-50%) centering) composes with it.
 *   dragHandleProps — spread onto the grab area (the card header). Buttons and
 *                     links inside the handle keep working — drags only start
 *                     from non-interactive parts.
 *
 * The offset resets whenever `resetKey` changes (a different storm/card).
 */
export function useDraggable(resetKey) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useEffect(() => { setOffset({ x: 0, y: 0 }); }, [resetKey]);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    setDragging(true);
    const base = offsetRef.current;
    const sx = e.clientX;
    const sy = e.clientY;
    const clamp = (v, max) => Math.min(Math.max(v, 0), max);
    const move = (ev) => setOffset({
      x: base.x + clamp(ev.clientX, window.innerWidth) - sx,
      y: base.y + clamp(ev.clientY, window.innerHeight) - sy,
    });
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, []);

  return {
    dragStyle: { '--drag-x': `${offset.x}px`, '--drag-y': `${offset.y}px` },
    dragHandleProps: {
      onPointerDown,
      style: { cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' },
    },
  };
}
