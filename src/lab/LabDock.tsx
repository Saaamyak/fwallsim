import { Bug, ChevronDown, ChevronUp, FlaskConical, ListChecks, Maximize2, Minimize2, Network, Send, Users } from 'lucide-react';
import { UsersLab } from './UsersLab';
import { VpnLab } from './VpnLab';
import { WanLab } from './WanLab';
import { MgmtLab } from './MgmtLab';
import { Globe, Lock, MonitorCog } from 'lucide-react';
import { loadScenario, setUi, useStore, type DockTab } from '../store';
import { SCENARIOS } from '../engine/defaults';
import { Dropdown } from '../gui/ui';
import { Topology } from './Topology';
import { TrafficGen } from './TrafficGen';
import { PacketWalk, DebugFlow } from './PacketWalk';

const TABS: { id: DockTab; label: string; icon: JSX.Element }[] = [
  { id: 'traffic', label: 'Traffic Generator', icon: <Send size={14} /> },
  { id: 'topology', label: 'Topology', icon: <Network size={14} /> },
  { id: 'walk', label: 'Packet Walk', icon: <ListChecks size={14} /> },
  { id: 'debug', label: 'Debug Flow', icon: <Bug size={14} /> },
  { id: 'users', label: 'Users', icon: <Users size={14} /> },
  { id: 'vpn', label: 'VPN', icon: <Lock size={14} /> },
  { id: 'wan', label: 'WAN', icon: <Globe size={14} /> },
  { id: 'mgmt', label: 'Mgmt', icon: <MonitorCog size={14} /> },
];

export function LabDock() {
  const dock = useStore((s) => s.ui.dock);
  const tab = useStore((s) => s.ui.dockTab);
  return (
    <div className={`dock ${dock}`}>
      <div className="dock-bar">
        <span className="dock-title">
          <FlaskConical size={15} /> Lab
        </span>
        {TABS.map((t) => (
          <button key={t.id} title={t.label} className={`dock-tab ${tab === t.id && dock !== 'min' ? 'on' : ''}`} onClick={() => setUi({ dockTab: t.id, dock: dock === 'min' ? 'normal' : dock })}>
            {t.icon} <span className="tab-label">{t.label}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <Dropdown
          className="dock-tab"
          right
          label="Scenario"
          items={[{ label: 'Load lab scenario (replaces config)' }, ...SCENARIOS.map((s) => ({ label: <span title={s.desc}>{s.name}</span>, onClick: () => loadScenario(s.id) }))]}
        />
        {dock !== 'max' ? (
          <button className="dock-tab" title="Maximize" onClick={() => setUi({ dock: 'max' })}>
            <Maximize2 size={14} />
          </button>
        ) : (
          <button className="dock-tab" title="Restore" onClick={() => setUi({ dock: 'normal' })}>
            <Minimize2 size={14} />
          </button>
        )}
        <button className="dock-tab" title={dock === 'min' ? 'Show' : 'Hide'} onClick={() => setUi({ dock: dock === 'min' ? 'normal' : 'min' })}>
          {dock === 'min' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {dock !== 'min' && (
        <div className="dock-body">
          {tab === 'traffic' && <TrafficGen />}
          {tab === 'topology' && <Topology />}
          {tab === 'walk' && <PacketWalk />}
          {tab === 'debug' && <DebugFlow />}
          {tab === 'users' && <UsersLab />}
          {tab === 'vpn' && <VpnLab />}
          {tab === 'wan' && <WanLab />}
          {tab === 'mgmt' && <MgmtLab />}
        </div>
      )}
    </div>
  );
}
