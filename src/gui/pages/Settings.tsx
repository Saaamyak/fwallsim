import { useState } from 'react';
import { factoryReset, toast, updateConfig, useStore } from '../../store';
import { gobj, objectOf } from '../../engine/config';
import { Confirm, Field, Section, Seg, Toggle } from '../ui';

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'US/Eastern', 'US/Central', 'US/Pacific', 'Australia/Sydney', 'UTC'];
const THEMES = [
  { v: 'jade', label: 'Jade' },
  { v: 'neutrino', label: 'Neutrino' },
  { v: 'mariner', label: 'Mariner' },
  { v: 'graphite', label: 'Graphite' },
  { v: 'dark-matter', label: 'Dark Matter' },
];

export function SettingsPage() {
  const config = useStore((s) => s.config);
  const g = (n: string) => gobj(config, 'system global', n);
  const [f, setF] = useState({
    hostname: g('hostname'),
    timezone: g('timezone'),
    sport: g('admin-sport'),
    port: g('admin-port'),
    ssh: g('admin-ssh-port'),
    redirect: g('admin-https-redirect') === 'enable',
    timeout: g('admintimeout'),
    theme: g('gui-theme'),
    rpf: gobj(config, 'system settings', 'strict-src-check') === 'enable',
    lockN: g('admin-lockout-threshold'),
    lockT: g('admin-lockout-duration'),
    overlap: gobj(config, 'system settings', 'allow-subnet-overlap') === 'enable',
  });
  const [err, setErr] = useState('');
  const [reset, setReset] = useState(false);
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const apply = () => {
    if (!/^[A-Za-z0-9_-]{1,35}$/.test(f.hostname)) return setErr('Host name: 1-35 characters, letters, digits, - and _ only.');
    const t = Number(f.timeout);
    if (!(t >= 1 && t <= 480)) return setErr('Idle timeout must be 1–480 minutes.');
    for (const p of [f.sport, f.port, f.ssh]) if (!(/^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 65535)) return setErr('Ports must be 1–65535.');
    if (new Set([f.sport, f.port, f.ssh]).size !== 3) return setErr('HTTPS, HTTP and SSH must use different ports.');
    if (!(/^\d+$/.test(f.lockN) && Number(f.lockN) >= 1 && Number(f.lockN) <= 10)) return setErr('Lockout threshold must be 1–10 attempts.');
    if (!(/^\d+$/.test(f.lockT) && Number(f.lockT) >= 1 && Number(f.lockT) <= 86400)) return setErr('Lockout duration must be 1–86400 seconds.');
    setErr('');
    updateConfig((c) => {
      const o = objectOf(c, 'system global').f;
      o.hostname = f.hostname;
      o.timezone = f.timezone;
      o['admin-sport'] = f.sport;
      o['admin-port'] = f.port;
      o['admin-ssh-port'] = f.ssh;
      o['admin-https-redirect'] = f.redirect ? 'enable' : 'disable';
      o.admintimeout = f.timeout;
      o['gui-theme'] = f.theme;
      o['admin-lockout-threshold'] = f.lockN;
      o['admin-lockout-duration'] = f.lockT;
      const s = objectOf(c, 'system settings').f;
      s['strict-src-check'] = f.rpf ? 'enable' : 'disable';
      s['allow-subnet-overlap'] = f.overlap ? 'enable' : 'disable';
    }, 'Edit system.global');
    toast('Settings applied');
  };

  return (
    <div className="page">
      <div className="page-title">Settings</div>
      <div className="form-card">
        {err && <p className="err-text">{err}</p>}
        <Section title="System Settings">
          <Field label="Host name">
            <input className="inp" value={f.hostname} onChange={(e) => up('hostname', e.target.value)} />
          </Field>
          <Field label="Time zone">
            <select className="sel" value={f.timezone} onChange={(e) => up('timezone', e.target.value)}>
              {ZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </Field>
        </Section>
        <Section title="Administration Settings">
          <Field label="HTTP port">
            <input className="inp sm" value={f.port} onChange={(e) => up('port', e.target.value)} />
            <div style={{ marginTop: 6 }}>
              <Toggle on={f.redirect} onChange={(v) => up('redirect', v)} label="Redirect to HTTPS" />
            </div>
          </Field>
          <Field label="HTTPS port" help="Changing this changes which TCP port local-in HTTPS admin access answers on.">
            <input className="inp sm" value={f.sport} onChange={(e) => up('sport', e.target.value)} />
          </Field>
          <Field label="SSH port">
            <input className="inp sm" value={f.ssh} onChange={(e) => up('ssh', e.target.value)} />
          </Field>
          <Field label="Idle timeout (minutes)">
            <input className="inp sm" value={f.timeout} onChange={(e) => up('timeout', e.target.value)} />
          </Field>
          <Field label="Lockout threshold" help="Failed logins from one IP before it is locked out (admin-lockout-threshold).">
            <input className="inp sm" value={f.lockN} onChange={(e) => up('lockN', e.target.value)} />
          </Field>
          <Field label="Lockout duration (seconds)">
            <input className="inp sm" value={f.lockT} onChange={(e) => up('lockT', e.target.value)} />
          </Field>
        </Section>
        <Section title="View Settings">
          <Field label="Theme">
            <Seg value={f.theme} onChange={(v) => up('theme', v)} options={THEMES} />
          </Field>
        </Section>
        <Section title="Advanced (system settings)">
          <Field label="Strict reverse path check" help="set strict-src-check enable: the best route back to the source must use the ingress interface (default is loose: any route).">
            <Toggle on={f.rpf} onChange={(v) => up('rpf', v)} />
          </Field>
          <Field label="Allow subnet overlap" help="set allow-subnet-overlap enable">
            <Toggle on={f.overlap} onChange={(v) => up('overlap', v)} />
          </Field>
        </Section>
        <Section title="Factory reset">
          <Field label="Reset to factory defaults" help="Same as 'execute factoryreset'. Wipes the configuration, logs and the admin password.">
            <button className="btn danger" onClick={() => setReset(true)}>
              Factory reset…
            </button>
          </Field>
        </Section>
        <div className="form-footer">
          <button className="btn primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
      {reset && <Confirm msg="This will erase all configuration and log you out. Continue?" yesLabel="Reset" onNo={() => setReset(false)} onYes={factoryReset} />}
    </div>
  );
}
