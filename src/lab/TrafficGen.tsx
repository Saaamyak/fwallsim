import { useMemo, useState } from 'react';
import { CheckCircle, Send, Trash2, XCircle, ListChecks } from 'lucide-react';
import { clearHistory, sendTraffic, setUi, useStore } from '../store';
import { buildNet } from '../engine/net';
import type { Proto } from '../engine/objects';
import { HOSTS } from '../engine/topology';
import { fmtTime } from '../gui/ui';

const PRESETS: { label: string; proto: Proto; port: number }[] = [
  { label: 'HTTPS', proto: 'tcp', port: 443 },
  { label: 'HTTP', proto: 'tcp', port: 80 },
  { label: 'Ping', proto: 'icmp', port: 0 },
  { label: 'DNS', proto: 'udp', port: 53 },
  { label: 'SSH', proto: 'tcp', port: 22 },
  { label: 'RDP', proto: 'tcp', port: 3389 },
  { label: 'FTP', proto: 'tcp', port: 21 },
];

const QUICK: { label: string; src: string; dst: string; proto: Proto; port: number }[] = [
  { label: 'PC1 browses www.example.com', src: 'pc1', dst: 'www.example.com', proto: 'tcp', port: 443 },
  { label: 'PC1 pings 8.8.8.8', src: 'pc1', dst: '8.8.8.8', proto: 'icmp', port: 0 },
  { label: 'PC2 opens YouTube', src: 'pc2', dst: 'www.youtube.com', proto: 'tcp', port: 443 },
  { label: 'PC1 opens admin GUI (192.168.1.99)', src: 'pc1', dst: '192.168.1.99', proto: 'tcp', port: 443 },
  { label: 'Internet user visits your website (203.0.113.10:80)', src: 'user', dst: '203.0.113.10', proto: 'tcp', port: 80 },
  { label: 'Attacker tries SSH to your WAN', src: 'attacker', dst: '203.0.113.10', proto: 'tcp', port: 22 },
  { label: 'Attacker tries RDP to PC1 directly', src: 'attacker', dst: '192.168.1.110', proto: 'tcp', port: 3389 },
  { label: 'Web server updates (HTTPS out)', src: 'web', dst: 'www.example.com', proto: 'tcp', port: 443 },
  { label: 'PC1 pings Branch-PC (IPsec VPN)', src: 'pc1', dst: '10.20.0.10', proto: 'icmp', port: 0 },
  { label: 'Remote-Laptop RDP to PC1 (SSL-VPN)', src: 'laptop', dst: '192.168.1.110', proto: 'tcp', port: 3389 },
];

export function TrafficGen() {
  const config = useStore((s) => s.config);
  const history = useStore((s) => s.runtime.history);
  const selected = useStore((s) => s.ui.selectedResult);
  const src = useStore((s) => s.ui.labSrc);
  const net = useMemo(() => buildNet(config), [config]);
  const [dst, setDst] = useState('www.example.com');
  const [proto, setProto] = useState<Proto>('tcp');
  const [port, setPort] = useState('443');

  const fwIps = net.ifList.filter((i) => i.ipStr && !i.memberOf);
  const send = (s = src, d = dst, p = proto, pt = Number(port)) => {
    if (!d.trim()) return;
    sendTraffic({ srcHost: s, dst: d.trim(), proto: p, dport: pt, label: `${HOSTS.find((h) => h.id === s)?.name} → ${d.trim()} ${p === 'icmp' ? 'ping' : `${p.toUpperCase()}/${pt}`}` });
  };
  const srcState = net.hosts.find((h) => h.host.id === src);

  return (
    <div className="lab-grid">
      <div className="lab-form">
        <div className="row">
          <label>Source</label>
          <select className="sel" value={src} onChange={(e) => setUi({ labSrc: e.target.value })}>
            {HOSTS.filter((h) => h.canSend).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span />
          <span className="muted" style={{ fontSize: 11 }}>
            {srcState ? (srcState.ok ? `${srcState.ip}/${srcState.prefix}${srcState.gw ? `, gw ${srcState.gw}` : ''}${srcState.dns ? `, dns ${srcState.dns}` : ''}` : <span className="err-text">{srcState.note}</span>) : ''}
          </span>
        </div>
        <div className="row">
          <label>Destination</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="inp" style={{ flex: 1 }} value={dst} onChange={(e) => setDst(e.target.value)} placeholder="IP or name" list="lab-dsts" />
            <datalist id="lab-dsts">
              {fwIps.map((i) => (
                <option key={i.name} value={i.ipStr}>{`FortiGate ${i.name}`}</option>
              ))}
              {net.hosts
                .filter((h) => h.ip && h.host.id !== src)
                .map((h) => (
                  <option key={h.host.id} value={h.ip}>
                    {h.host.name}
                  </option>
                ))}
              {['www.example.com', 'www.youtube.com', 'www.facebook.com', 'ftp.example.org'].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="row">
          <label>Application</label>
          <div className="presets" style={{ margin: 0 }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className={`btn sm ${proto === p.proto && (p.proto === 'icmp' || Number(port) === p.port) ? 'primary' : ''}`}
                onClick={() => {
                  setProto(p.proto);
                  setPort(String(p.port));
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label>Protocol / port</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <select className="sel" style={{ width: 90 }} value={proto} onChange={(e) => setProto(e.target.value as Proto)}>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
            </select>
            {proto !== 'icmp' && <input className="inp sm" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />}
          </div>
        </div>
        <div className="row">
          <span />
          <button className="btn primary" onClick={() => send()}>
            <Send size={14} /> Send traffic
          </button>
        </div>
        <div className="muted" style={{ fontSize: 11, margin: '10px 0 4px', textTransform: 'uppercase', fontWeight: 700 }}>
          Quick tests
        </div>
        {QUICK.map((q) => (
          <div key={q.label}>
            <a
              style={{ fontSize: 12, lineHeight: 1.9 }}
              onClick={() => {
                setUi({ labSrc: q.src });
                setDst(q.dst);
                setProto(q.proto);
                setPort(String(q.port));
                send(q.src, q.dst, q.proto, q.port);
              }}
            >
              ▸ {q.label}
            </a>
          </div>
        ))}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          <b>Results</b>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={clearHistory} disabled={!history.length}>
            <Trash2 size={12} /> Clear
          </button>
        </div>
        {history.map((r) => (
          <div key={r.id} className={`result ${selected === r.id ? 'selected' : ''}`} onClick={() => setUi({ selectedResult: r.id })} onDoubleClick={() => setUi({ selectedResult: r.id, dockTab: 'walk' })}>
            {r.ok ? <CheckCircle size={16} color="var(--ok)" style={{ flex: 'none', marginTop: 1 }} /> : <XCircle size={16} color="var(--err)" style={{ flex: 'none', marginTop: 1 }} />}
            <div style={{ flex: 1 }}>
              <div>
                <b>{r.label}</b> <span className="muted mono" style={{ fontSize: 11 }}>{fmtTime(r.time, false)}</span>
              </div>
              <div className={r.ok ? 'muted' : 'err-text'} style={{ fontSize: 12 }}>
                {r.summary}
              </div>
            </div>
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation();
                setUi({ selectedResult: r.id, dockTab: 'walk' });
              }}
            >
              <ListChecks size={12} /> Packet Walk
            </button>
          </div>
        ))}
        {!history.length && (
          <div className="empty">
            Pick a source and destination, then click <b>Send traffic</b>, or try a quick test.
            <br />
            On a factory-default unit everything through the firewall is blocked (implicit deny). Try it, then build a policy.
          </div>
        )}
      </div>
    </div>
  );
}
