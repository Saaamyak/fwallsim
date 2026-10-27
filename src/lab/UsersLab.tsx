import { useMemo, useState } from 'react';
import { CheckCircle, LogIn, LogOut, XCircle } from 'lucide-react';
import { firewallLogin, firewallLogout, useStore } from '../store';
import { buildNet } from '../engine/net';
import { DIRECTORY } from '../engine/topology';
import type { LoginResult } from '../engine/auth';

export function UsersLab() {
  const config = useStore((s) => s.config);
  const auth = useStore((s) => s.runtime.lab.auth);
  const net = useMemo(() => buildNet(config), [config]);
  const [host, setHost] = useState('pc1');
  const [user, setUser] = useState('jsmith');
  const [pw, setPw] = useState('');
  const [res, setRes] = useState<LoginResult | null>(null);
  const pcs = net.hosts.filter((h) => h.host.kind === 'pc');
  const cur = pcs.find((h) => h.host.id === host);
  const internal = net.ifs['internal'];

  return (
    <div className="lab-grid">
      <div className="lab-form">
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          Simulates the user typing credentials into the FortiGate authentication portal (https://{internal?.ipStr || '192.168.1.99'}:1003/fgtauth).
        </div>
        <div className="row">
          <label>From PC</label>
          <select className="sel" value={host} onChange={(e) => setHost(e.target.value)}>
            {pcs.map((h) => (
              <option key={h.host.id} value={h.host.id}>
                {h.host.name} ({h.ip ?? 'no IP'})
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Username</label>
          <input className="inp" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div className="row">
          <label>Password</label>
          <input className="inp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setRes(firewallLogin(host, user.trim(), pw))} />
        </div>
        <div className="row">
          <span />
          <button className="btn primary" onClick={() => setRes(firewallLogin(host, user.trim(), pw))}>
            <LogIn size={14} /> Log in
          </button>
        </div>
        {res && (
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
        {cur && auth[cur.ip ?? ''] && (
          <p className="ok-text" style={{ fontSize: 12 }}>
            {cur.host.name} is logged in as {auth[cur.ip!].user}.
          </p>
        )}
      </div>
      <div>
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          <b>Logged-in users</b>
        </div>
        {Object.values(auth).map((a) => (
          <div className="result" key={a.ip}>
            <CheckCircle size={16} color="var(--ok)" style={{ flex: 'none', marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <b>{a.user}</b> on {a.host} <span className="mono muted">{a.ip}</span>
              <div className="muted" style={{ fontSize: 12 }}>
                groups: {a.groups.join(', ') || 'none'} · {a.method}
                {a.server ? ` via ${a.server}` : ''}
              </div>
            </div>
            <button className="btn sm" onClick={() => firewallLogout(a.ip)}>
              <LogOut size={12} /> Log out
            </button>
          </div>
        ))}
        {!Object.keys(auth).length && <div className="empty">Nobody is logged in.</div>}
        <div style={{ padding: '8px 12px', fontSize: 12 }}>
          <b>Directory accounts (AD-Server {DIRECTORY.ip})</b>
          <div className="mono muted" style={{ marginTop: 4 }}>
            {DIRECTORY.users.map((u) => (
              <div key={u.user}>
                {u.user} / {u.pw} · {u.groups.map((g) => g.split(',')[0].slice(3)).join(', ')}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
