import { useCallback, useRef, useState } from 'react';
import type React from 'react';

// Drag-to-resize width for a panel, remembered per browser. `direction` is 1 when the
// handle sits on the panel's right edge (dragging right grows it) and -1 when it sits on
// the left edge (dragging left grows it).
export function useResizableWidth(storageKey: string, initial: number, min: number, max: number, direction: 1 | -1 = 1) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved >= min && saved <= max) return saved;
    } catch {
      // storage unavailable — fall back to the default
    }
    return initial;
  });
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (ev: PointerEvent) => {
      const next = startWidth + (ev.clientX - startX) * direction;
      setWidth(Math.min(max, Math.max(min, Math.round(next))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(false);
      try {
        localStorage.setItem(storageKey, String(widthRef.current));
      } catch {
        // ignore
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [direction, max, min, storageKey]);

  const reset = useCallback(() => {
    setWidth(initial);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [initial, storageKey]);

  return { width, dragging, handleProps: { onPointerDown, onDoubleClick: reset } };
}
