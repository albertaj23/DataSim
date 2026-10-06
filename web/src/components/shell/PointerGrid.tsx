import { useEffect, useRef } from 'react';
import { reduced } from '../../lib/motion';

/** Project-wide dotted field inspired by the pasted Kokonut mouse-effect card. */
export function PointerGrid() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const field = ref.current;
    if (!field || reduced() || window.matchMedia?.('(pointer: coarse)').matches) return;
    let raf = 0;
    let x = 50; let y = 35; let nextX = x; let nextY = y;
    const render = () => {
      raf = 0; x += (nextX - x) * 0.14; y += (nextY - y) * 0.14;
      field.style.setProperty('--pointer-x', `${x}%`); field.style.setProperty('--pointer-y', `${y}%`);
      if (Math.abs(nextX - x) > 0.1 || Math.abs(nextY - y) > 0.1) raf = requestAnimationFrame(render);
    };
    const move = (event: PointerEvent) => {
      nextX = (event.clientX / Math.max(window.innerWidth, 1)) * 100;
      nextY = (event.clientY / Math.max(window.innerHeight, 1)) * 100;
      if (!raf) raf = requestAnimationFrame(render);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} id="pointer-grid-backdrop" aria-hidden="true" />;
}
