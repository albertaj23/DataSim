import { useEffect, useRef, type SVGProps } from 'react';
import { animate as animeAnimate } from 'animejs';
import { reduced } from '../../lib/motion';

/** DataSim mark: parallel transaction lanes meeting shared database state. */
export function DataSimSymbol({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="1" y="1" width="38" height="38" rx="12" fill="#101B28" stroke="#294154" />
      <path data-logo-lane d="M4.5 13.5h6M29.5 13.5h6" stroke="#55D6E8" strokeWidth="2" strokeLinecap="round" />
      <path data-logo-lane d="M4.5 26.5h6M29.5 26.5h6" stroke="#FF8297" strokeWidth="2" strokeLinecap="round" />
      <circle cx="5" cy="13.5" r="1.5" fill="#55D6E8" />
      <circle cx="35" cy="26.5" r="1.5" fill="#FF8297" />
      <path data-logo-lane d="M10.5 13.5h4.1c3.2 0 4.2 5.9 7.4 5.9h3.9M29.5 26.5h-4.1c-3.2 0-4.2-5.9-7.4-5.9h-3.9" stroke="#8DA8BA" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 13.5c1.9 0 2.9 2.3 4.1 4.1M26 26.5c-1.9 0-2.9-2.3-4.1-4.1" stroke="#D6E5EC" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse data-logo-ring cx="20" cy="12" rx="6" ry="2.5" fill="#172A39" stroke="#55D6E8" strokeWidth="1.7" />
      <path data-logo-ring d="M14 12v15.1c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V12" fill="#142432" stroke="#55D6E8" strokeWidth="1.7" />
      <path d="M14.1 18.2c0 1.4 2.7 2.5 5.9 2.5s5.9-1.1 5.9-2.5M14.1 24.4c0 1.4 2.7 2.5 5.9 2.5s5.9-1.1 5.9-2.5" stroke="#55D6E8" strokeWidth="1.45" />
      <path d="M14.2 27.1c.4 1.2 2.9 2.1 5.8 2.1 3.3 0 6-1.2 6-2.6" stroke="#FF8297" strokeWidth="1.45" strokeLinecap="round" />
      <circle data-signal="cyan" cx="5" cy="13.5" r="1.6" fill="#A7F3FC" opacity="0" />
      <circle data-signal="coral" cx="35" cy="26.5" r="1.6" fill="#FFD0D8" opacity="0" />
    </svg>
  );
}

export function DataSimLogo({ className = '', symbolSize = 36, animateIntro = false }: { className?: string; symbolSize?: number; animateIntro?: boolean }) {
  const logoRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = logoRef.current;
    if (!animateIntro || reduced() || !root) return;

    const mark = root.querySelector('svg');
    const wordmark = root.querySelector('.datasim-wordmark');
    const cyan = root.querySelector('[data-signal="cyan"]');
    const coral = root.querySelector('[data-signal="coral"]');
    if (!mark || !wordmark || !cyan || !coral) return;

    // A single, short entrance followed by two crossing signals; no idle loop.
    const entrance = animeAnimate(mark, {
      scale: [0.86, 1.08, 1],
      duration: 680,
      ease: 'outBack',
    });
    const wordmarkIn = animeAnimate(wordmark, {
      translateX: [-5, 0],
      opacity: [0.65, 1],
      duration: 520,
      delay: 90,
      ease: 'outCubic',
    });
    const cyanPass = animeAnimate(cyan, {
      cx: [5, 35],
      cy: [13.5, 26.5],
      opacity: [0, 1, 0],
      duration: 900,
      delay: 180,
      ease: 'inOutSine',
    });
    const coralPass = animeAnimate(coral, {
      cx: [35, 5],
      cy: [26.5, 13.5],
      opacity: [0, 1, 0],
      duration: 900,
      delay: 300,
      ease: 'inOutSine',
    });

    return () => {
      entrance.revert();
      wordmarkIn.revert();
      cyanPass.revert();
      coralPass.revert();
    };
  }, [animateIntro]);

  return (
    <span ref={logoRef} className={`inline-flex items-center gap-2.5 ${className}`}>
      <DataSimSymbol width={symbolSize} height={symbolSize} className="shrink-0" />
      <span className="datasim-wordmark font-sans text-[1.12rem] font-semibold tracking-[-0.045em] text-stone-900">DataSim</span>
    </span>
  );
}
