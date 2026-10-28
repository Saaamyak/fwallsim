import { useEffect, useState } from 'react';
import { ADMIN_SOURCES, changePassword, dismissPhoneNotice, dismissWelcome, factoryReset, lockedUntil, login, logout, setupAdmin, useStore } from '../store';
import { gobj } from '../engine/config';
import { APP_VERSION, FW_BUILD, FW_VERSION, MODEL } from '../engine/serialize';

const NOT_REAL_PW = "This password only protects the simulator in this browser. Don't reuse a real password.";

function Brand() {
  const host = useStore((s) => gobj(s.config, 'system global', 'hostname'));
  return (
    <>
      <div className="brand">
        <div className="logo">F</div>
        FWallSim
      </div>
      <div className="muted" style={{ marginBottom: 22 }}>
        {host === MODEL ? host : `${host} · ${MODEL}`} · v{APP_VERSION}
      </div>
    </>
  );
}

/** Phones only, before logging in: the full firewall GUI is a desktop tool, so say so once and let them carry on. */
export function PhoneNotice() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(location.origin).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="login-bg">
      <div className="login-card welcome">
        <Brand />
        <h1 className="welcome-title">Best on a computer or tablet</h1>
        <p className="muted">
          FWallSim is a full firewall interface, like the real one: wide policy tables, long forms and a command line. It works on a phone, but it is cramped.
        </p>
        <p className="muted">For the best experience, open <b>{location.host}</b> on a laptop, desktop or tablet.</p>
        <button className="btn primary" type="button" onClick={dismissPhoneNotice} autoFocus>
          Continue on this phone
        </button>
        <button className="btn" type="button" style={{ marginTop: 8 }} onClick={copy}>
          {copied ? 'Link copied' : 'Copy link to open later'}
        </button>
      </div>
    </div>
  );
}

/** First visit in this browser: what FWallSim is, before anything else. */
export function Welcome() {
  return (
    <div className="login-bg">
      <div className="login-card welcome">
        <Brand />
        <h1 className="welcome-title">Learn firewalls by building one</h1>
        <p className="muted">A practice FortiGate-style firewall that runs in your browser. No device, licence or trial needed.</p>
        <ul className="welcome-list">
          <li>A firewall GUI and CLI that look and behave like FortiOS 7.4</li>
          <li>19 guided labs and challenges that tick green when your setup really works</li>
          <li>The Packet Walk explains every decision the firewall makes, step by step</li>
          <li>Private: your firewall, settings and progress stay in this browser. No account needed.</li>
        </ul>
        <button className="btn primary" type="button" onClick={dismissWelcome} autoFocus>
          Get started
        </button>
        <div className="muted welcome-legal">
          FWallSim is an independent learning tool. It is not affiliated with or endorsed by Fortinet. FortiGate, FortiOS and other Fortinet names are trademarks of Fortinet, Inc., used here only to describe what is simulated.
        </div>
      </div>
    </div>
  );
}

/** Factory-fresh unit: set the admin password instead of guessing the empty factory one. */
export function Setup() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (a.length < 1) return setErr('Password cannot be empty.');
    if (a !== b) return setErr('Passwords do not match.');
    const r = setupAdmin(a);
    if (r) setErr(r);
  };
  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <Brand />
        <div className="brand" style={{ fontSize: 18 }}>
          Create your admin password
        </div>
        <div className="muted" style={{ marginBottom: 18 }}>
          You will log in as <b>admin</b> with this password.
        </div>
        {err && <div className="login-err">{err}</div>}
        <input className="inp" type="password" placeholder="New Password" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
        <input className="inp" type="password" placeholder="Confirm Password" value={b} onChange={(e) => setB(e.target.value)} />
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 10 }}>
          {NOT_REAL_PW}
        </div>
        <button className="btn primary" type="submit">
          Save and log in
        </button>
        <div className="muted" style={{ marginTop: 18, fontSize: 11, lineHeight: 1.6 }}>
          On a real FortiGate the first login is <b>admin</b> with an empty password, and you must set a new one straight away. FWallSim does that step here.
        </div>
      </form>
    </div>
  );
}

export function Login() {
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [from, setFrom] = useState('pc1');
  const [now, setNow] = useState(Date.now());
  useStore((s) => s.runtime.adminLock); // re-render when a lockout starts or ends
  const until = lockedUntil(from);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const secs = until ? Math.max(1, Math.ceil((until - now) / 1000)) : 0;
  const source = ADMIN_SOURCES.find((s) => s.id === from)?.label.split(' (')[0] ?? from;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = login(user.trim(), pass, from);
    // While locked, the live countdown below replaces the message.
    setErr(r && !lockedUntil(from) ? r : '');
  };
  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <Brand />
        {until > 0 && (
          <div className="login-err">
            Too many failed login attempts from {source}. Login is locked for {secs} more second{secs === 1 ? '' : 's'}. Wait, choose another PC under "Connecting from", or reset below.
          </div>
        )}
        {!until && err && <div className="login-err">{err}</div>}
        <input className="inp" placeholder="Username" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
        <input className="inp" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
        <label className="muted" style={{ fontSize: 11 }}>Connecting from (lab)</label>
        <select className="inp" value={from} onChange={(e) => setFrom(e.target.value)}>
          {ADMIN_SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn primary" type="submit">
          Login
        </button>
        <div className="muted" style={{ marginTop: 18, fontSize: 11, lineHeight: 1.6 }}>
          Log in as <b>admin</b> with the password you created. Forgot it? Reset below; your training progress is kept.
        </div>
        <button
          type="button"
          className="link"
          style={{ marginTop: 10, fontSize: 11, background: 'none', border: 0, color: 'var(--accent, #2f8f5b)', cursor: 'pointer', padding: 0, textAlign: 'left' }}
          onClick={() => {
            if (!confirm('Forgot the password or locked out?\n\nThis resets the simulated FortiGate to factory defaults, and you create a new admin password. All configuration is erased. Your training progress is kept.')) return;
            factoryReset();
            setPass('');
            setErr('');
          }}
        >
          Forgot password or locked out? Reset to factory defaults
        </button>
      </form>
    </div>
  );
}

export function ChangePassword() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (a.length < 1) return setErr('Password cannot be empty.');
    if (a !== b) return setErr('Passwords do not match.');
    changePassword(a);
  };
  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ fontSize: 18 }}>
          You are required to change your password
        </div>
        <div className="muted" style={{ marginBottom: 18 }}>
          Please change your password to continue.
        </div>
        {err && <div className="login-err">{err}</div>}
        <input className="inp" type="password" placeholder="New Password" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
        <input className="inp" type="password" placeholder="Confirm Password" value={b} onChange={(e) => setB(e.target.value)} />
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 10 }}>
          {NOT_REAL_PW}
        </div>
        <button className="btn primary" type="submit">
          OK
        </button>
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => logout('cancelled password change')}>
          Cancel
        </button>
      </form>
    </div>
  );
}

export function Booting() {
  return (
    <div className="boot">
      {`${MODEL} (12:00-05.14.2024)
Ver:05000013
Serial number: ${MODEL}TK26000001
CPU: 1000MHz
Total RAM: 2 GB
Initializing boot device...
Initializing MAC... nplite#0
Please wait for OS to boot, or press any key to display configuration menu......

Booting OS...
Reading boot image... OK
Initializing firewall...

System is starting...
FWallSim v${APP_VERSION} (simulated firmware ${FW_VERSION} build${FW_BUILD}) ...`}
    </div>
  );
}
