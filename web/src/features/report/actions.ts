import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApplyFixBody, FindingFix, RunReport, StartRunResponse } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../ui';
import { rerunKind, rerunOverrides } from './logic';

/** Server-side actions of the report: start a re-run with the stored overrides, apply a finding's fix as a new revision. */
export function useReportActions(report: RunReport) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'rerun' | 'fix' | null>(null);
  const projectId = report.run.projectId;

  const rerun = useCallback(async (fix?: FindingFix | null): Promise<boolean> => {
    setBusy('rerun');
    // 409 RUN_ACTIVE: another run (maybe someone else's) holds the global lock; retry a few times before giving up.
    let res = await api.post<StartRunResponse>(`/projects/${projectId}/runs`, { kind: rerunKind(report), overrides: rerunOverrides(report.settings, fix) });
    for (let i = 0; i < 3 && res.status === 409; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await api.post<StartRunResponse>(`/projects/${projectId}/runs`, { kind: rerunKind(report), overrides: rerunOverrides(report.settings, fix) });
    }
    setBusy(null);
    if (!res.ok) { toast.error('Could not start the run', errorMessage(res)); return false; }
    toast.info('Run started', 'Following it live.');
    navigate(`/runs/${res.body.runId}`);
    return true;
  }, [navigate, projectId, report, toast]);

  /** Returns the new revision number, or null when the server refused. */
  const applyFix = useCallback(async (fix: FindingFix, label: string): Promise<number | null> => {
    setBusy('fix');
    const body: ApplyFixBody = { fix, note: `${label} (from run ${report.run.runId.slice(0, 8)})` };
    const res = await api.post<{ revisionNo: number }>(`/projects/${projectId}/apply-fix`, body);
    setBusy(null);
    if (!res.ok) { toast.error('Could not apply the fix', errorMessage(res)); return null; }
    toast.success(`Applied "${label}"`, `Saved as revision ${res.body.revisionNo}.`);
    return res.body.revisionNo;
  }, [projectId, report.run.runId, toast]);

  return { rerun, applyFix, busy };
}
