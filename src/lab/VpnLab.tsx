import { useMemo, useState } from 'react';
import { CheckCircle, Plug, Unplug, XCircle } from 'lucide-react';
import { sendTraffic, setUi, sslVpnConnect, sslVpnDisconnect, useStore } from '../store';
import { buildNet } from '../engine/net';
import { BRANCH, sslSettingsField, type SslResult } from '../engine/vpn';

export function VpnLab() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const [gw, setGw] = useState(net.ifs['wan1']?.ipStr || '203.0.113.10');
  const [port, setPort] = useState(sslSettingsField(config, 'port') || '443');
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [res, setRes] = useState<SslResult | null>(null);
  const cl = lab.sslClients?.laptop;
  const tunnels = Object.values(net.tunnels);
  const test = (src: string, dst: string, proto: 'tcp' | 'icmp', dport: number, label: string) => {
    sendTraffic({ srcHost: src, dst, proto, dport, label });
    setUi({ dockTab: 'walk' });
  };

  return (
    <div className="lab-grid">
      <div className="lab-form">
        <b>Branch-FGT (remote side, fixed)</b>
        <div className="kv" style={{ margin: '6px 0 10px', fontSize: 12 }}>
          <span>Public IP</span>
          <span className="mono">{BRANCH.publicIp}</span>
          <span>Branch LAN</span>
          <span className="mono">{BRANCH.lan} (Branch-PC {BRANCH.pc})</span>
          <span>Expects peer</span>
          <span className="mono">{BRANCH.p1.peerIp} (your wan1)</span>
          <span>IKE version</span>
          <span className="mono">{BRANCH.p1.ikeVersion}</span>
          <span>Phase 1</span>
          <span className="mono">{BRANCH.p1.proposals.join(', ')} · DH {BRANCH.p1.dhgrp.join(',')}</span>
          <span>Pre-shared key</span>
          <span className="mono">{BRANCH.p1.psk}</span>
          <span>Phase 2</span>
          <span className="mono">
            {BRANCH.p2.proposals.join(', ')} · PFS DH {BRANCH.p2.dhgrp.join(',')}
          </span>
          <span>Selectors</span>
          <span className="mono">
            local {BRANCH.p2.local} ↔ remote {BRANCH.p2.remote}
          </span>
        </div>
        <div style={{ marginBottom: 8 }}>
          {tunnels.length ? (
            tunnels.map((t) => (
              <div key={t.name} className={t.up ? 'ok-text' : 'err-text'} style={{ fontSize: 12 }}>
                {t.up ? '▲' : '▼'} {t.name}: {t.up ? 'Up' : t.error}
              </div>
            ))
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              No tunnel on HQ yet. Use VPN &gt; IPsec Wizard.
            </span>
          )}
        </div>
        <div className="presets">
          <button className="btn sm" onClick={() => test('pc1', BRANCH.pc, 'icmp', 0, 'PC1 → Branch-PC ping')}>
            PC1 → Branch-PC ping
          </button>
          <button className="btn sm" onClick={() => test('branchpc', '192.168.1.110', 'tcp', 3389, 'Branch-PC → PC1 RDP')}>
            Branch-PC → PC1 RDP
          </button>
          <button className="btn sm" onClick={() => test('pc1', BRANCH.pc, 'tcp', 445, 'PC1 → Branch-PC SMB')}>
            PC1 → Branch file share
          </button>
        </div>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <b>Remote-Laptop: FortiClient (SSL-VPN)</b>
        {cl ? (
          <div style={{ marginTop: 8 }}>
            <div className="ok-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <CheckCircle size={15} /> Connected as {cl.user}. Tunnel IP {cl.ip}, portal {cl.portal}
            </div>
            <div className="presets" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => test('laptop', '192.168.1.110', 'tcp', 3389, 'Laptop → PC1 RDP (VPN)')}>
                Laptop → PC1 RDP
              </button>
              <button className="btn sm" onClick={() => test('laptop', '10.10.10.10', 'tcp', 80, 'Laptop → Web-Server (VPN)')}>
                Laptop → Web-Server
              </button>
              <button className="btn sm" onClick={() => test('laptop', 'www.example.com', 'tcp', 443, 'Laptop → internet')}>
                Laptop → internet
              </button>
              <button className="btn sm danger" onClick={() => sslVpnDisconnect('laptop')}>
                <Unplug size={12} /> Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8, maxWidth: 420 }}>
            <div className="lab-form" style={{ padding: 0, border: 0 }}>
              <div className="row">
                <label>Remote Gateway</label>
                <input className="inp" value={gw} onChange={(e) => setGw(e.target.value)} />
              </div>
              <div className="row">
                <label>Port</label>
                <input className="inp sm" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <div className="row">
                <label>Username</label>
                <input className="inp" value={user} onChange={(e) => setUser(e.target.value)} />
              </div>
              <div className="row">
                <label>Password</label>
                <input className="inp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
              <div className="row">
                <span />
                <button className="btn primary" onClick={() => setRes(sslVpnConnect('laptop', gw.trim(), Number(port), user.trim(), pw))}>
                  <Plug size={14} /> Connect
                </button>
              </div>
            </div>
          </div>
        )}
        {res && !cl && (
          <div className="walk-lines">
            <div className={res.ok ? 'ok-text' : 'err-text'} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
              {res.ok ? <CheckCircle size={14} /> : <XCircle size={14} />} {res.msg}
            </div>
            {res.steps.map((s, i) => (
              <div key={i} className="mono" style={{ fontSize: 11 }}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
