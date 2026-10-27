import { useState } from 'react';
import { RefreshCw, Search, XCircle } from 'lucide-react';
import { endSessions, useStore } from '../../store';
import { hex8 } from '../../engine/runtime';
import { ContextMenu, fmtBytes, useNow } from '../ui';

export function SessionsPage() {
  const sessions = useStore((s) => s.runtime.sessions);
  const now = useNow(1000);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const rows = sessions.filter((s) => !q || `${s.src} ${s.dst} ${s.srcname} ${s.dport} ${s.policyid}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-title">FortiView Sessions</div>
      <div className="toolbar">
        <button className="btn" onClick={() => setQ(q)}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button className="btn danger" disabled={sel === null} onClick={() => sel !== null && endSessions([sel])}>
          <XCircle size={14} /> End Session
        </button>
        <button className="btn danger" disabled={!sessions.length} onClick={() => endSessions('all')}>
          End All Sessions
        </button>
        <span className="grow" />
        <span className="muted">{rows.length} sessions</span>
        <div className="search">
          <Search size={14} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Protocol</th>
              <th>Src Intf</th>
              <th>Dst Intf</th>
              <th>Policy</th>
              <th>NAT Source</th>
              <th>NAT Destination</th>
              <th>State</th>
              <th className="num">Bytes</th>
              <th className="num">Expires (s)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                className={`row ${sel === s.id ? 'selected' : ''}`}
                onClick={() => setSel(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSel(s.id);
                  setMenu({ x: e.clientX, y: e.clientY, id: s.id });
                }}
              >
                <td className="mono">{hex8(s.id)}</td>
                <td>
                  {s.srcname} <span className="mono muted">{s.src}:{s.sport}</span>
                </td>
                <td className="mono">
                  {s.dst}
                  {s.proto === 'icmp' ? '' : ':' + s.dport}
                </td>
                <td>{s.proto.toUpperCase()}</td>
                <td>{s.srcintf}</td>
                <td>{s.dstintf}</td>
                <td>{s.policyid}</td>
                <td className="mono">{s.natSrc ? `${s.natSrc}:${s.natSport}` : ''}</td>
                <td className="mono">{s.dnatDst ? `${s.dnatDst}:${s.dnatPort}` : ''}</td>
                <td>{s.state}</td>
                <td className="num">{fmtBytes(s.sentbyte + s.rcvdbyte)}</td>
                <td className="num">{Math.max(0, Math.round(s.ttl - (now - s.created) / 1000))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No active sessions. Send some traffic from the Lab panel below.</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        Each row is one entry in the session table. Replies are matched against these sessions instead of the policy table, which is how stateful inspection works. Ending a session forces the next packet back through the policy lookup.
      </p>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[{ label: 'End Session', icon: <XCircle size={14} />, onClick: () => endSessions([menu.id]) }]} />}
    </div>
  );
}
