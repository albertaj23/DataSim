import { Activity, FlaskConical, Folder, Info, ListOrdered, RefreshCw, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { useHealth } from '../lib/useHealth';
import { Button, HowMeasurementsWork, Popover, PopoverContent, PopoverTrigger, StatusDot, Tooltip, cn, type StatusKind } from '../ui';

const NAV = [
  { to: '/', label: 'Projects', icon: Folder, match: (p: string) => p === '/' || p.startsWith('/p/') },
  { to: '/runs', label: 'Runs', icon: Activity, match: (p: string) => p.startsWith('/runs') || p.startsWith('/compare') },
  { to: '/lab', label: 'Concurrency Lab', icon: FlaskConical, match: (p: string) => p.startsWith('/lab') },
  { to: '/stepper', label: 'Transaction Stepper', icon: ListOrdered, match: (p: string) => p.startsWith('/stepper') },
] as const;

const railBtn = 'relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-fg';

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="flex items-center gap-2 text-sm"><StatusDot status={ok ? 'ok' : 'bad'} />{label}</span>
      <span className="truncate font-mono text-xs text-muted">{detail ?? (ok ? 'ok' : 'down')}</span>
    </div>
  );
}

function HealthDot() {
  const { health, offline, loading, refresh } = useHealth();
  const status: StatusKind = loading ? 'idle' : offline ? 'bad' : health?.ok ? 'ok' : 'warn';
  const text = loading ? 'Checking' : offline ? 'API offline' : health?.ok ? 'All systems ok' : 'Degraded';
  return (
    <Popover>
      <Tooltip content={text} side="right">
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Health: ${text}`} className={railBtn}>
            <StatusDot status={status} className="h-2.5 w-2.5" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="right" align="end" width={260}>
        <div className="mb-1 text-sm font-medium">{text}</div>
        {offline || !health ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">The API did not answer on /api/health. Check that the server is running (npm run demo), then retry.</p>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={refresh}>Retry</Button>
          </div>
        ) : (
          <div className="divide-y divide-line">
            <Row label="MySQL" ok={health.mysql.ok} detail={health.mysql.version ?? health.mysql.error} />
            <Row label="performance_schema" ok={health.mysql.performanceSchema} detail={health.mysql.performanceSchema ? 'ON' : 'OFF'} />
            <Row label="Redis" ok={health.redis.ok} detail={health.redis.ok ? 'reachable' : health.redis.error} />
            <Row label="Runner user" ok={health.runner.ok} detail={health.runner.ok ? 'dsim_runner' : health.runner.error} />
            {health.activeRunId && <div className="py-1 text-xs text-info">Run in progress</div>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SettingsButton() {
  const { theme, setTheme } = useTheme();
  return (
    <Popover>
      <Tooltip content="Settings" side="right">
        <PopoverTrigger asChild>
          <button type="button" aria-label="Settings" className={railBtn}><Settings size={18} /></button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="right" align="end" width={220}>
        <div className="mb-2 text-sm font-medium">Settings</div>
        <div className="mb-1 text-xs text-muted">Theme</div>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface p-0.5">
          {(['dark', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => setTheme(t)}
              className={cn('h-7 rounded text-sm capitalize transition-colors duration-150', theme === t ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}
            >
              {t}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HelpButton() {
  return (
    <Popover>
      <Tooltip content="How measurements work" side="right">
        <PopoverTrigger asChild>
          <button type="button" aria-label="How measurements work" className={railBtn}><Info size={18} /></button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="right" align="end" width={340}>
        <div className="mb-2 text-sm font-medium">How measurements work</div>
        <HowMeasurementsWork />
      </PopoverContent>
    </Popover>
  );
}

export function Rail() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="flex h-full w-12 shrink-0 flex-col items-center border-r border-line bg-surface py-2">
      <NavLink to="/" aria-label="DataSim home" className="mb-3 mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg">
        <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden>
          <path d="M5 9h22M5 16h22M5 23h13" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="25" cy="23" r="2.4" fill="var(--accent)" />
        </svg>
      </NavLink>
      <div className="flex flex-1 flex-col items-center gap-1">
        {NAV.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Tooltip key={to} content={label} side="right">
              <NavLink to={to} aria-label={label} aria-current={active ? 'page' : undefined} className={cn(railBtn, active && 'bg-surface-2 text-fg')}>
                {active && <span className="absolute -left-1.5 top-2 h-5 w-0.5 rounded-full bg-accent" />}
                <Icon size={18} />
              </NavLink>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex flex-col items-center gap-1">
        <HelpButton />
        <SettingsButton />
        <HealthDot />
      </div>
    </nav>
  );
}
