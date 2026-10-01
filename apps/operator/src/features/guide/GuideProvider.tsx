/**
 * The workspace guide's state, mounted once in the shell (routes/__root.tsx,
 * beside the assistant drawer): whether the dialog is open and which tab each
 * workspace's guide was last left on. The dialog itself is rendered by
 * WorkspaceGuideHost, also in the shell, so "Go there" can navigate while the
 * dialog plays its exit.
 *
 * The workspace arrives as a prop rather than from useWorkspace(): that hook
 * lives in routes/__root.tsx, which imports this file.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../../lib/auth';
import type { WorkspaceKey } from '../../lib/workspaces';
import { guideFor, isGuideWorkspace } from './guideContent';
import { WorkspaceGuideDialog } from './WorkspaceGuideDialog';

export interface GuideContextValue {
  /** The active workspace. */
  workspace: WorkspaceKey;
  /** This workspace has a guide (court desk, till, kitchen, Touch Shop). */
  available: boolean;
  open: boolean;
  openGuide: () => void;
  closeGuide: () => void;
  /** The tab this workspace's guide was last left on, if any. */
  tab: string | null;
  setTab: (sectionId: string) => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuideOrNull(): GuideContextValue | null {
  return useContext(GuideContext);
}

export function GuideProvider({ workspace, children }: { workspace: WorkspaceKey; children: ReactNode }) {
  const available = guideFor(workspace) !== null;
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<Partial<Record<WorkspaceKey, string>>>({});

  // Another workspace is another guide: never leave one open across a switch.
  useEffect(() => {
    setOpen(false);
  }, [workspace]);

  const openGuide = useCallback(() => {
    if (available) setOpen(true);
  }, [available]);
  const closeGuide = useCallback(() => setOpen(false), []);
  const setTab = useCallback((sectionId: string) => setTabs((cur) => ({ ...cur, [workspace]: sectionId })), [workspace]);

  const value = useMemo<GuideContextValue>(
    () => ({ workspace, available, open: open && available, openGuide, closeGuide, tab: tabs[workspace] ?? null, setTab }),
    [workspace, available, open, openGuide, closeGuide, tabs, setTab],
  );
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

/** The dialog, for the active workspace. Renders nothing while it is shut. */
export function WorkspaceGuideHost() {
  const guide = useGuideOrNull();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const onNavigate = useCallback((to: string) => void navigate({ to }), [navigate]);
  if (!guide?.open || !staff || !isGuideWorkspace(guide.workspace)) return null;
  return (
    <WorkspaceGuideDialog
      workspace={guide.workspace}
      staffId={staff.id}
      role={staff.role}
      tab={guide.tab}
      onTab={guide.setTab}
      onClose={guide.closeGuide}
      onNavigate={onNavigate}
    />
  );
}
