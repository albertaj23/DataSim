import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animate } from 'animejs';
import { reduced } from '../../lib/motion';
import { DataSimSymbol } from './DataSimLogo';

/** A short full-screen brand transition into the workspace library, replayed on reload. */
export function WorkspaceIntro({ enabled = true }: { enabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  const initiallyEnabled = useRef(enabled);

  useLayoutEffect(() => {
    if (!initiallyEnabled.current || started.current || reduced()) return;
    started.current = true;
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const appRoot = document.getElementById('root');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (appRoot) appRoot.inert = true;
    skipRef.current?.focus({ preventScroll: true });
    return () => {
      if (appRoot) appRoot.inert = false;
      const target = previousFocus && previousFocus !== document.body
        ? previousFocus
        : document.querySelector<HTMLElement>('main h1');
      target?.focus({ preventScroll: true });
    };
  }, [visible]);

  useEffect(() => {
    const root = rootRef.current;
    if (!visible || !root || reduced()) return;

    const lanePaths = Array.from(root.querySelectorAll<SVGPathElement>('[data-intro-lane]'));
    const screenSignals = Array.from(root.querySelectorAll<SVGCircleElement>('[data-screen-signal]'));
    const mark = root.querySelector<SVGSVGElement>('[data-intro-mark]');
    const cyanMarkSignal = mark?.querySelector<SVGCircleElement>('[data-signal="cyan"]');
    const coralMarkSignal = mark?.querySelector<SVGCircleElement>('[data-signal="coral"]');
    const markLanes = Array.from(mark?.querySelectorAll<SVGPathElement>('[data-logo-lane]') ?? []);
    const markRings = Array.from(mark?.querySelectorAll<SVGElement>('[data-logo-ring]') ?? []);
    const wordmark = root.querySelector<HTMLElement>('[data-intro-wordmark]');
    const animations: Array<ReturnType<typeof animate>> = [];

    if (lanePaths.length) animations.push(animate(lanePaths, {
      strokeDashoffset: [1900, 0],
      opacity: [0.12, 0.7, 0.3],
      duration: 1650,
      ease: 'outCubic',
    }));
    if (screenSignals[0]) animations.push(animate(screenSignals[0], {
      cx: [-120, 1560], cy: [278, 622], opacity: [0, 0.95, 0],
      duration: 1550, delay: 100, ease: 'inOutSine',
    }));
    if (screenSignals[1]) animations.push(animate(screenSignals[1], {
      cx: [1560, -120], cy: [622, 278], opacity: [0, 0.85, 0],
      duration: 1550, delay: 240, ease: 'inOutSine',
    }));
    if (mark) animations.push(animate(mark, {
      scale: [0.62, 1.08, 1],
      rotate: [-8, 2, 0],
      opacity: [0.15, 1],
      duration: 920,
      delay: 580,
      ease: 'outBack',
    }));
    if (markLanes.length) animations.push(animate(markLanes, {
      strokeDasharray: [48, 48], strokeDashoffset: [48, 0], opacity: [0, 1],
      duration: 780, delay: 440, ease: 'outCubic',
    }));
    if (markRings.length) animations.push(animate(markRings, {
      strokeDasharray: [68, 68], strokeDashoffset: [68, 0], opacity: [0, 1],
      duration: 720, delay: 540, ease: 'outCubic',
    }));
    if (wordmark) animations.push(animate(wordmark, {
      translateY: [10, 0], opacity: [0, 1],
      duration: 580, delay: 930, ease: 'outCubic',
    }));
    if (cyanMarkSignal) animations.push(animate(cyanMarkSignal, {
      cx: [5, 35], cy: [13.5, 26.5], opacity: [0, 1, 0],
      duration: 760, delay: 760, ease: 'inOutSine',
    }));
    if (coralMarkSignal) animations.push(animate(coralMarkSignal, {
      cx: [35, 5], cy: [26.5, 13.5], opacity: [0, 1, 0],
      duration: 760, delay: 900, ease: 'inOutSine',
    }));

    const finishTimer = window.setTimeout(() => {
      setFading(true);
    }, 2080);
    const hideTimer = window.setTimeout(() => setVisible(false), 2500);
    const failsafeTimer = window.setTimeout(() => setVisible(false), 3000);

    return () => {
      window.clearTimeout(finishTimer);
      window.clearTimeout(hideTimer);
      window.clearTimeout(failsafeTimer);
      animations.forEach((animation) => animation.revert());
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal((
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-title"
      aria-describedby="intro-copy"
      className="fixed inset-0 z-[9999] grid h-[100dvh] w-[100dvw] place-items-center overflow-hidden bg-[#08121d] text-white isolate"
      style={{
        backgroundImage: 'radial-gradient(ellipse at 50% 44%, rgba(43,104,130,.2), transparent 42%), radial-gradient(ellipse at 50% 100%, rgba(20,50,66,.38), transparent 55%)',
        opacity: fading ? 0 : 1,
        transition: fading ? 'opacity 420ms cubic-bezier(0.7, 0, 0.84, 0)' : 'none',
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(143,190,207,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(143,190,207,.09) 1px, transparent 1px)', backgroundSize: '64px 64px', maskImage: 'linear-gradient(transparent, black 18%, black 82%, transparent)' }} />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path data-intro-lane d="M-120 278 1560 622" fill="none" stroke="#55D6E8" strokeWidth="1.5" strokeDasharray="1900" strokeDashoffset="1900" opacity=".15" />
        <path data-intro-lane d="M-120 622 1560 278" fill="none" stroke="#FF8297" strokeWidth="1.5" strokeDasharray="1900" strokeDashoffset="1900" opacity=".12" />
        <circle data-screen-signal cx="-120" cy="278" r="3" fill="#A7F3FC" opacity="0" />
        <circle data-screen-signal cx="1560" cy="622" r="3" fill="#FFD0D8" opacity="0" />
      </svg>

      <div className="relative z-10 flex min-h-full w-full flex-col items-center justify-center px-6 text-center">
        <div data-intro-mark className="rounded-[2.4rem] p-5 shadow-[0_0_80px_rgba(85,214,232,.14)] [transform-box:fill-box] [transform-origin:center]">
          <DataSimSymbol width={208} height={208} />
        </div>
        <h1 id="intro-title" data-intro-wordmark className="mt-8 font-sans text-5xl font-semibold tracking-[-0.06em] text-white opacity-0 sm:text-6xl">DataSim</h1>
        <p id="intro-copy" className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-sky-200/70 sm:text-xs">Concurrent systems · observable outcomes</p>
      </div>

      <button
        ref={skipRef}
        type="button"
        onClick={() => setVisible(false)}
        className="absolute bottom-6 right-6 z-20 rounded-md border border-white/15 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-sky-300/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
      >
        Skip intro
      </button>
    </div>
  ), document.body);
}
