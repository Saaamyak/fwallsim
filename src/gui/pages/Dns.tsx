import { useState } from 'react';
import { toast, updateConfig, useStore } from '../../store';
import { gobj, objectOf } from '../../engine/config';
import { isIp } from '../../engine/ip';
import { Field, Seg } from '../ui';

const FG = ['96.45.45.45', '96.45.46.46'];

export function DnsPage() {
  const config = useStore((s) => s.config);
  const p0 = gobj(config, 'system dns', 'primary');
  const s0 = gobj(config, 'system dns', 'secondary');
  const [mode, setMode] = useState<'fg' | 'specify'>(p0 === FG[0] && s0 === FG[1] ? 'fg' : 'specify');
  const [p, setP] = useState(p0);
  const [s, setS] = useState(s0);
  const [domain, setDomain] = useState(gobj(config, 'system dns', 'domain'));
  const [err, setErr] = useState('');

  const apply = () => {
    const primary = mode === 'fg' ? FG[0] : p;
    const secondary = mode === 'fg' ? FG[1] : s;
    if (!isIp(primary) || (secondary && !isIp(secondary))) return setErr('Enter valid DNS server IP addresses.');
    setErr('');
    updateConfig((c) => {
      const o = objectOf(c, 'system dns');
      o.f.primary = primary;
      o.f.secondary = secondary || '0.0.0.0';
      if (domain.trim()) o.f.domain = [domain.trim()];
      else delete o.f.domain;
    }, 'Edit system.dns');
    toast('DNS settings applied');
  };

  return (
    <div className="page">
      <div className="page-title">DNS Settings</div>
      <div className="form-card">
        {err && <p className="err-text">{err}</p>}
        <Field label="DNS servers">
          <Seg
            value={mode}
            onChange={setMode}
            options={[
              { v: 'fg', label: 'Use FortiGuard Servers' },
              { v: 'specify', label: 'Specify' },
            ]}
          />
        </Field>
        <Field label="Primary DNS server">
          <input className="inp" disabled={mode === 'fg'} value={mode === 'fg' ? FG[0] : p} onChange={(e) => setP(e.target.value)} />
        </Field>
        <Field label="Secondary DNS server">
          <input className="inp" disabled={mode === 'fg'} value={mode === 'fg' ? FG[1] : s} onChange={(e) => setS(e.target.value)} />
        </Field>
        <Field label="Local domain name">
          <input className="inp" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="lab.local" />
        </Field>
        <Field label="DNS Protocols">
          <label>
            <input type="checkbox" checked readOnly /> DNS (UDP/53)
          </label>
        </Field>
        <p className="muted">
          These are the FortiGate's own resolvers. Interfaces whose DHCP server uses "Same as System DNS" hand these addresses to their clients, so clients query them through the firewall and need a policy that allows DNS.
        </p>
        <div className="form-footer">
          <button className="btn primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
