import { ChevronDown, Settings2, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
export type WorkspaceView = 'workspace' | 'shipments' | 'activity';
export function Navigation({ view, onView, onSettings }: { view: WorkspaceView; onView: (view: WorkspaceView) => void; onSettings: () => void }) {
  return <header className="navigation"><div className="nav-inner">
    <Button variant="ghost" className="wordmark" onClick={() => onView('workspace')} aria-label="Sefer home">sefer<span className="brand-period">.</span></Button>
    <nav aria-label="Main navigation" className="nav-links">{([['workspace', 'Shipment Workspace'], ['shipments', 'Shipments'], ['activity', 'Activity']] as const).map(([id, label]) => <Button key={id} variant="ghost" className={`nav-link ${view === id ? 'is-active' : ''}`} onClick={() => onView(id)} aria-current={view === id ? 'page' : undefined}>{label}</Button>)}</nav>
    <div className="nav-profile"><span className="workspace-name">Broker workspace <ArrowUpRight size={12}/></span><span className="nav-divider"/><Button variant="ghost" size="icon" onClick={onSettings} aria-label="Workspace settings" title="Workspace settings"><Settings2/></Button><Button variant="ghost" className="profile-button" onClick={onSettings} aria-label="Profile and workspace settings"><span className="avatar">BW</span><ChevronDown size={13}/></Button></div>
  </div></header>;
}
