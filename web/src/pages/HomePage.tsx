import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChartNoAxesCombined, PlayCircle } from 'lucide-react';
import { api, type AppConfig } from '../lib/api';
import { HomeScene } from '../components/home/HomeScene';
import { CardStack } from '../components/ui/CardStack';
import { Chapter } from '../components/story/Chapter';
import { ChapterRail } from '../components/story/ChapterRail';
import { Story, type ChapterDef } from '../components/story/Story';
import { enterUp } from '../lib/motion';

const DESTINATIONS = [
  { to: '/scenarios', label: 'Choose a scenario', sub: 'Start with a shared-state question, its invariant, and a run mode.', icon: BookOpen, tint: 'bg-emerald-500/15 text-emerald-400' },
  { to: '/stress', label: 'Run a workload', sub: 'Race concurrent operations and measure whether the property holds.', icon: PlayCircle, tint: 'bg-amber-500/15 text-amber-400' },
  { to: '/runs', label: 'Inspect evidence', sub: 'Open checks, schedules, locks, traces, and saved run results in one place.', icon: ChartNoAxesCombined, tint: 'bg-sky-500/15 text-sky-400' },
];

export default function HomePage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const chapters = useMemo<ChapterDef[]>(() => [
    { id: 'story', title: 'Concurrency workbench', kind: 'scene', glyph: 'slice' },
    { id: 'next', title: 'Start exploring', kind: 'work', glyph: 'spark' },
  ], []);

  useEffect(() => { api.get<AppConfig>('/config').then((r) => r.ok && setCfg(r.body)).catch(() => undefined); }, []);
  useEffect(() => { enterUp('.dest-card', { delay: 200 }); }, []);

  return (
    <Story title="Home" chapters={chapters}>
      <ChapterRail />
      <Chapter id="story" kind="scene"><HomeScene /></Chapter>
      <Chapter id="next" kind="work" title="Start exploring" question="Choose a question, run it, then follow the evidence.">
        <CardStack
          items={DESTINATIONS.map((destination) => ({ id: destination.to, value: destination }))}
          label="Choose a path"
          className="home-destinations-stack"
          renderItem={(d) => (
            <Link key={d.to} to={d.to} className="dest-card glass-card group rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <span className={`grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 ${d.tint}`}><d.icon size={24} /></span>
              <h3 className="mt-4 text-lg font-semibold text-stone-900">
                {d.label} <span className="inline-block text-stone-400 transition-transform group-hover:translate-x-1">→</span>
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-500">{d.sub}</p>
            </Link>
          )}
        />
        <p className="mt-8 text-center text-sm text-stone-500">
          Want to control the order yourself?{' '}
          <Link to="/runs?tab=stepper" className="font-semibold text-violet-400 transition-colors hover:text-violet-500">Step through two live transactions, locks, and isolation →</Link>
        </p>
        {cfg && <p className="mt-2 text-center text-sm text-stone-400">The included playback example uses a {cfg.leaseMs / 1000}s lease to demonstrate fencing.</p>}
      </Chapter>
    </Story>
  );
}
