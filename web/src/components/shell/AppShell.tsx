import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Boxes, ChartNoAxesCombined, FilePlus2, FlaskConical, Sun, Zap } from 'lucide-react';
import { useShortcut } from '../../lib/keys';
import { PageMetaProvider, SidebarProvider, useSidebar, usePageMetaValue } from '../../lib/shell';
import { useTheme } from '../../lib/theme';
import { CommandSearch, type CommandItem } from '../watermelon/command-search';
import { MoreSheet } from './MoreSheet';
import { AmbientLayer, ScrollChrome } from './ScrollChrome';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { PointerGrid } from './PointerGrid';
import { DesktopNavbar } from './DesktopNavbar';
import { WorkspaceIntro } from '../brand/WorkspaceIntro';
import { itemFor } from './nav';

function Palette() {
  const navigate = useNavigate();
  const { searchOpen, setSearchOpen } = useSidebar();
  const { toggle } = useTheme();
  const meta = usePageMetaValue();
  const go = (to: string) => () => navigate(to);
  const items: CommandItem[] = [
    ...(meta.commands ?? []).map((c) => ({ id: c.id, title: c.title, section: 'On this page', icon: <Zap size={16} />, action: c.action })),
    { id: 'workspaces', title: 'Workspaces', section: 'Build', icon: <Boxes size={16} />, action: go('/') },
    { id: 'templates', title: 'Templates', section: 'Build', icon: <FilePlus2 size={16} />, action: go('/templates') },
    { id: 'runs', title: 'Runs & evidence', section: 'Go to', icon: <ChartNoAxesCombined size={16} />, action: go('/runs') },
    { id: 'stepper', title: 'Guided transaction schedule', section: 'Evidence', icon: <FlaskConical size={16} />, action: go('/runs?tab=stepper') },
    { id: 'lab', title: 'Configure a run', section: 'Evidence', icon: <FlaskConical size={16} />, action: go('/runs?tab=lab') },
    { id: 'theme', title: 'Switch light / dark', section: 'Handy', icon: <Sun size={16} />, action: toggle },
  ];
  return (
    <div className="fixed left-[calc(50%-160px)] top-20 z-[75] w-0 md:left-[calc(50%-200px)]">
      <CommandSearch items={items} placeholder="Search…" open={searchOpen} onOpenChange={setSearchOpen} hideTrigger />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { toggle } = useSidebar();
  useShortcut('mod+b', toggle);
  const item = itemFor(pathname);
  const meta = usePageMetaValue();
  useEffect(() => { document.title = `${meta.title ?? item?.label ?? (pathname === '/device' ? 'This device' : 'DataSim')} · DataSim`; }, [meta.title, item, pathname]);
  return (
    <div className="min-h-screen">
      <PointerGrid />
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar />
      <div className="app-column">
        <TopBar focus={pathname === '/device'} />
        <DesktopNavbar />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+2rem)] sm:px-6">{children}</main>
      </div>
      <TabBar />
      <MoreSheet />
      <Palette />
      <ScrollChrome />
      <AmbientLayer />
      <WorkspaceIntro enabled={pathname === '/' || pathname.startsWith('/workspaces')} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <PageMetaProvider>
      <SidebarProvider focus={pathname === '/device'}>
        <Frame>{children}</Frame>
      </SidebarProvider>
    </PageMetaProvider>
  );
}
