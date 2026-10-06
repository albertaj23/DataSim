import { Boxes, ChartNoAxesCombined, FilePlus2, type LucideIcon } from 'lucide-react';

export interface NavItem { to: string; label: string; short: string; Icon: LucideIcon }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Build', items: [
    { to: '/', label: 'Workspaces', short: 'Workspaces', Icon: Boxes },
    { to: '/templates', label: 'Templates', short: 'Templates', Icon: FilePlus2 },
  ] },
  { label: 'Evidence', items: [
    { to: '/runs', label: 'Runs & evidence', short: 'Runs', Icon: ChartNoAxesCombined },
  ] },
];

export const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function itemFor(pathname: string): NavItem | undefined {
  return ALL_ITEMS.find((i) => (i.to === '/' ? pathname === '/' || pathname.startsWith('/workspaces/') : pathname.startsWith(i.to)));
}
