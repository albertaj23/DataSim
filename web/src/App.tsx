import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { ThemeProvider } from './lib/theme';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { PageSkeleton } from './shell/Page';
import { Rail } from './shell/Rail';
import { EmptyState, ToastProvider, TooltipProvider } from './ui';

const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const StudioPage = lazy(() => import('./pages/StudioPage'));
const RunsPage = lazy(() => import('./pages/RunsPage'));
const RunReportPage = lazy(() => import('./pages/RunReportPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const LabPage = lazy(() => import('./pages/LabPage'));
const StepperPage = lazy(() => import('./pages/StepperPage'));
const KitPage = lazy(() => import('./pages/KitPage'));

const MIN_WIDTH = 1024;
function useIsDesktop() {
  const [ok, setOk] = useState(() => window.innerWidth >= MIN_WIDTH);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MIN_WIDTH}px)`);
    const on = () => setOk(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return ok;
}

/** Each route gets its own error boundary (reset on navigation) and a skeleton while its chunk loads. */
function Screen({ children }: { children: ReactElement }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  const desktop = useIsDesktop();
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>
          {desktop ? (
            <div className="flex h-full">
              <Rail />
              {/* Pages scroll inside <main>; the Studio fills it edge to edge and manages its own scrolling. */}
              <main className="min-w-0 flex-1 overflow-auto">
                <Routes>
                  <Route path="/" element={<Screen><ProjectsPage /></Screen>} />
                  <Route path="/p/:id" element={<Screen><StudioPage /></Screen>} />
                  <Route path="/runs" element={<Screen><RunsPage /></Screen>} />
                  <Route path="/runs/:id" element={<Screen><RunReportPage /></Screen>} />
                  <Route path="/compare" element={<Screen><ComparePage /></Screen>} />
                  <Route path="/lab" element={<Screen><LabPage /></Screen>} />
                  <Route path="/stepper" element={<Screen><StepperPage /></Screen>} />
                  <Route path="/_kit" element={<Screen><KitPage /></Screen>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <EmptyState
                icon={<Monitor size={20} />}
                title="Best viewed on a desktop"
                description={`DataSim needs a window at least ${MIN_WIDTH}px wide. Widen this window or open it on a larger screen.`}
              />
            </div>
          )}
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
