import { useMemo } from 'react';
import { navigate, setUi, useStore } from '../store';
import { buildNet, type HostState } from '../engine/net';

const UP = 'var(--ok)';
const DOWN = '#9aa5a7';

function Box({ x, y, w, h, title, sub, fill = 'var(--panel)', stroke = 'var(--border-strong)', onClick, sel }: { x: number; y: number; w: number; h: number; title: string; sub?: string; fill?: string; stroke?: string; onClick?: () => void; sel?: boolean }) {
  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={6} fill={fill} stroke={sel ? 'var(--accent)' : stroke} strokeWidth={sel ? 2.5 : 1.2} />
      <text x={x} y={sub ? y - 3 : y + 4} textAnchor="middle" fontSize={12} fontWeight={600}>
        {title}
      </text>
      {sub && (
        <text x={x} y={y + 12} textAnchor="middle" fontSize={10.5} className="lbl-muted">
          {sub}
        </text>
      )}
    </g>
  );
}

function Link({ x1, y1, x2, y2, up, label, lx, ly }: { x1: number; y1: number; x2: number; y2: number; up: boolean; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={up ? UP : DOWN} strokeWidth={up ? 2.5 : 1.5} strokeDasharray={up ? undefined : '5 4'} />
      {label && (
        <text x={lx ?? (x1 + x2) / 2} y={ly ?? (y1 + y2) / 2 - 5} textAnchor="middle" fontSize={10.5} className="lbl-muted">
          {label}
        </text>
      )}
    </g>
  );
}

export function Topology() {
  const config = useStore((s) => s.config);
  const src = useStore((s) => s.ui.labSrc);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const host = (id: string) => net.hosts.find((h) => h.host.id === id) as HostState;
  const ifs = net.ifs;
  const ip = (n: string) => (ifs[n]?.ipStr ? `${ifs[n].ipStr}/${ifs[n].prefix}` : 'no IP');
  const pick = (id: string) => setUi({ labSrc: id, dockTab: 'traffic' });
  const hsub = (h: HostState) => (h.ok ? h.ip! : h.ip ? `${h.ip} (no DHCP)` : 'offline');
  const pc1 = host('pc1');
  const pc2 = host('pc2');
  const web = host('web');
  const inet = net.hosts.filter((h) => h.host.segment === 'internet' || h.host.segment === 'branch');

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <svg className="topo" viewBox="0 0 1100 300" preserveAspectRatio="xMidYMid meet">
        {/* LAN */}
        <Link x1={95} y1={70} x2={255} y2={130} up={!!ifs.internal1?.up} label="internal1" lx={170} ly={88} />
        <Link x1={95} y1={210} x2={255} y2={150} up={!!ifs.internal2?.up} label="internal2" lx={170} ly={198} />
        <Link x1={300} y1={140} x2={430} y2={140} up={!!ifs.internal?.up} label={`internal ${ip('internal')}`} lx={365} ly={130} />
        <Box x={80} y={60} w={130} h={42} title="PC1-Admin" sub={hsub(pc1)} sel={src === 'pc1'} onClick={() => pick('pc1')} />
        <Box x={80} y={220} w={130} h={42} title="PC2-Sales" sub={hsub(pc2)} sel={src === 'pc2'} onClick={() => pick('pc2')} />
        <Box x={275} y={140} w={70} h={34} title="switch" sub="hw-switch" />

        {/* FortiGate */}
        <Box x={530} y={140} w={200} h={70} title="FortiGate (FWallSim)" sub="click to open Interfaces" fill="var(--accent-soft)" stroke="var(--accent)" onClick={() => navigate('net-interfaces')} />

        {/* DMZ */}
        <Link x1={530} y1={175} x2={530} y2={245} up={!!ifs.dmz?.up} label={`dmz ${ip('dmz')}`} lx={600} ly={215} />
        <Box x={530} y={265} w={150} h={40} title="Web-Server" sub={`${web.ip} gw ${web.host.gw}`} sel={src === 'web'} onClick={() => pick('web')} />

        {/* WAN */}
        <Link x1={630} y1={130} x2={760} y2={130} up={!!ifs.wan1?.up} label={`wan1 ${ip('wan1')}`} lx={695} ly={120} />
        {lab.wan2Cable ? (
          <>
            <Link x1={630} y1={165} x2={745} y2={225} up={!!ifs.wan2?.up} label={`wan2 ${ip('wan2')}`} lx={665} ly={232} />
            <Box x={800} y={235} w={110} h={42} title="ISP2-Router" sub="198.18.10.1" fill={lab.ispDown?.wan2 ? 'var(--group)' : undefined} />
            <Link x1={855} y1={235} x2={950} y2={160} up={!lab.ispDown?.wan2} />
          </>
        ) : (
          <Link x1={630} y1={160} x2={700} y2={200} up={false} label="wan2 (no cable)" lx={690} ly={222} />
        )}
        <Box x={800} y={130} w={110} h={42} title="ISP-Router" sub={lab.ispDown?.wan1 ? 'OUTAGE' : '203.0.113.1'} />
        <Link x1={855} y1={130} x2={930} y2={130} up={!lab.ispDown?.wan1} label="" />
        <ellipse cx={1000} cy={130} rx={70} ry={42} fill="var(--group)" stroke="var(--border-strong)" />
        <text x={1000} y={126} textAnchor="middle" fontSize={13} fontWeight={600}>
          Internet
        </text>
        <text x={1000} y={142} textAnchor="middle" fontSize={10} className="lbl-muted">
          {inet.length} hosts
        </text>
      </svg>
      <div style={{ width: 300, borderLeft: '1px solid var(--border)', overflow: 'auto', fontSize: 12 }}>
        <div className="pick-group">Internet hosts</div>
        {inet.map((h) => (
          <div key={h.host.id} className={`pick-item ${src === h.host.id ? 'on' : ''}`} title={h.host.desc} onClick={() => h.host.canSend && pick(h.host.id)} style={{ cursor: h.host.canSend ? 'pointer' : 'default' }}>
            <b>{h.host.name}</b>
            <span className="detail mono">{h.ip}</span>
          </div>
        ))}
        <div className="muted" style={{ padding: '8px 14px' }}>
          Click a PC, the web server, Internet-User or Attacker to use it as the traffic source. Green links are up; grey dashed links are down.
        </div>
      </div>
    </div>
  );
}
