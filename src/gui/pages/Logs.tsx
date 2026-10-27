import { useState } from 'react';
import { Ban, Check, Download, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { clearLogs, setUi, toast, updateConfig, useStore } from '../../store';
import { gobj, objectOf } from '../../engine/config';
import type { TrafficLog } from '../../engine/runtime';
import { trafficRaw } from '../../engine/logfmt';
import { RemoteSyslogSection } from './Mgmt';
import { Field, Toggle, fmtBytes, fmtTime } from '../ui';

const rawLog = (l: TrafficLog) => trafficRaw(l);

function matches(l: TrafficLog, q: string): boolean {
  if (!q) return true;
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((term) => {
      const m = /^(\w+)=(.+)$/.exec(term);
      if (m) return String((l as unknown as Record<string, unknown>)[m[1]] ?? '').toLowerCase() === m[2];
      return rawLog(l).toLowerCase().includes(term) || l.srcname.toLowerCase().includes(term);
    });
}

function Result({ l }: { l: TrafficLog }) {
  if (l.action === 'deny')
    return (
      <span className="act-deny">
        <Ban size={13} /> Deny: {l.subtype === 'local' ? 'not allowed' : 'policy violation'}
      </span>
    );
  if (l.action === 'timeout') return <span className="warn-text">✓ Accept: no reply (timeout)</span>;
  if (l.action === 'server-rst') return <span className="warn-text">✓ Accept: server RST</span>;
  return (
    <span className="act-accept" style={{ fontWeight: 400 }}>
      <Check size={13} /> {fmtBytes(l.sentbyte)} / {fmtBytes(l.rcvdbyte)}
    </span>
  );
}

function TrafficLogPage({ subtype, title }: { subtype: 'forward' | 'local'; title: string }) {
  const logs = useStore((s) => s.runtime.trafficLogs);
  const filter = useStore((s) => s.ui.logFilter);
  const config = useStore((s) => s.config);
  const [sel, setSel] = useState<TrafficLog | null>(null);
  const rows = logs.filter((l) => l.subtype === subtype && matches(l, filter));

  const download = () => {
    const blob = new Blob([rows.map(rawLog).join('\n') + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${subtype}_traffic_log.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hint =
    subtype === 'forward'
      ? gobj(config, 'log setting', 'fwpolicy-implicit-log') !== 'enable'
        ? 'Allowed traffic is logged only by policies set to "Log Allowed Traffic: All Sessions". Implicit-deny drops are not logged unless "Log Violation Traffic" is on (right-click the Implicit Deny row).'
        : 'Allowed traffic is logged only by policies set to "Log Allowed Traffic: All Sessions".'
      : 'Local traffic is traffic to or from the FortiGate itself (admin access, ping to an interface). Enable it under Log & Report > Log Settings.';

  return (
    <div className="page">
      <div className="page-title">{title}</div>
      <div className="toolbar">
        <button className="btn" onClick={() => toast('Refreshed', 'info')}>
          <RefreshCw size={14} />
        </button>
        <button className="btn" onClick={download} disabled={!rows.length}>
          <Download size={14} /> Download raw logs
        </button>
        <button className="btn danger" onClick={() => clearLogs('traffic')}>
          <Trash2 size={14} /> Clear (lab only)
        </button>
        <span className="grow" />
        <span className="muted">{rows.length} entries</span>
        <div className="search">
          <Search size={14} />
          <input style={{ width: 260 }} placeholder="Filter, e.g. policyid=1 or 8.8.8.8" value={filter} onChange={(e) => setUi({ logFilter: e.target.value })} />
          {filter && <X size={14} style={{ cursor: 'pointer' }} onClick={() => setUi({ logFilter: '' })} />}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div className="tbl-wrap" style={{ flex: 1 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Source</th>
                <th>Destination</th>
                <th>Service</th>
                <th>Result</th>
                <th className="num">Policy ID</th>
                <th>Src Intf</th>
                <th>Dst Intf</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className={`row ${sel?.id === l.id ? 'selected' : ''}`} onClick={() => setSel(l)}>
                  <td className="mono">{fmtTime(l.time)}</td>
                  <td>
                    {l.srcip} <span className="muted">({l.srcname})</span>
                  </td>
                  <td className="mono">{l.dstip}</td>
                  <td>{l.service}</td>
                  <td>
                    <Result l={l} />
                  </td>
                  <td className="num">{l.policyid}</td>
                  <td>{l.srcintf}</td>
                  <td>{l.dstintf}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">{logs.length ? 'No log entries match the filter.' : 'No logs yet.'}</div>}
        </div>
        {sel && (
          <div className="side-card" style={{ width: 360 }}>
            <h4 style={{ display: 'flex' }}>
              Log Details <span style={{ flex: 1 }} />
              <X size={15} style={{ cursor: 'pointer' }} onClick={() => setSel(null)} />
            </h4>
            <div className="kv">
              <b style={{ gridColumn: 'span 2', color: 'var(--text)' }}>General</b>
              <span>Date/Time</span>
              <span>{fmtTime(sel.time)}</span>
              <span>Session ID</span>
              <span>{sel.sessionid}</span>
              <span>Duration</span>
              <span>{sel.duration}s</span>
              <span>NAT Translation</span>
              <span>{sel.trandisp}</span>
              <b style={{ gridColumn: 'span 2', color: 'var(--text)', marginTop: 6 }}>Source</b>
              <span>IP</span>
              <span>{sel.srcip}</span>
              <span>Source Port</span>
              <span>{sel.srcport}</span>
              <span>Country</span>
              <span>{sel.srccountry}</span>
              <span>Interface</span>
              <span>
                {sel.srcintf} ({sel.srcintfrole})
              </span>
              {sel.transip && (
                <>
                  <span>NAT IP</span>
                  <span>
                    {sel.transip}:{sel.transport}
                  </span>
                </>
              )}
              <b style={{ gridColumn: 'span 2', color: 'var(--text)', marginTop: 6 }}>Destination</b>
              <span>IP</span>
              <span>{sel.dstip}</span>
              <span>Port</span>
              <span>{sel.dstport}</span>
              <span>Country</span>
              <span>{sel.dstcountry}</span>
              <span>Interface</span>
              <span>
                {sel.dstintf} ({sel.dstintfrole})
              </span>
              {sel.tranip && (
                <>
                  <span>NAT (VIP) IP</span>
                  <span>
                    {sel.tranip}:{sel.tranport}
                  </span>
                </>
              )}
              <b style={{ gridColumn: 'span 2', color: 'var(--text)', marginTop: 6 }}>Action</b>
              <span>Action</span>
              <span>{sel.action}</span>
              <span>Policy</span>
              <span>
                {sel.policyid} {sel.policyname}
              </span>
              <span>Service</span>
              <span>{sel.service}</span>
              <span>Sent / Received</span>
              <span>
                {fmtBytes(sel.sentbyte)} / {fmtBytes(sel.rcvdbyte)}
              </span>
            </div>
            <h4 style={{ marginTop: 12 }}>Raw log</h4>
            <div className="console" style={{ height: 'auto', maxHeight: 200, fontSize: 11 }}>
              {rawLog(sel)}
            </div>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        {hint}
      </p>
    </div>
  );
}

export const ForwardLogPage = () => <TrafficLogPage subtype="forward" title="Forward Traffic" />;
export const LocalLogPage = () => <TrafficLogPage subtype="local" title="Local Traffic" />;

export function EventLogPage() {
  const events = useStore((s) => s.runtime.eventLogs);
  const [q, setQ] = useState('');
  const rows = events.filter((e) => !q || `${e.msg} ${e.user} ${e.action}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-title">System Events</div>
      <div className="toolbar">
        <button className="btn danger" onClick={() => clearLogs('event')}>
          <Trash2 size={14} /> Clear (lab only)
        </button>
        <span className="grow" />
        <div className="search">
          <Search size={14} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Level</th>
              <th>User</th>
              <th>Interface</th>
              <th>Action</th>
              <th>Description</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr className="row" key={`${e.id}-${e.time}`}>
                <td className="mono">{fmtTime(e.time)}</td>
                <td>
                  <span className={`badge ${e.level === 'alert' ? 'err' : e.level === 'warning' ? 'warn' : 'info'}`}>{e.level}</span>
                </td>
                <td>{e.user}</td>
                <td>{e.ui}</td>
                <td>{e.action}</td>
                <td>{e.logdesc}</td>
                <td>{e.msg}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No events.</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        Every configuration change and admin login is recorded here. This is the audit trail you would check on a real unit.
      </p>
    </div>
  );
}

export function LogSettingsPage() {
  const config = useStore((s) => s.config);
  const g = (n: string) => gobj(config, 'log setting', n) === 'enable';
  const set = (n: string, v: boolean) => updateConfig((c) => (objectOf(c, 'log setting').f[n] = v ? 'enable' : 'disable'), `Edit log.setting ${n}`);
  return (
    <div className="page">
      <div className="page-title">Log Settings</div>
      <div className="form-card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Local Log
        </div>
        <Field label="Disk / Memory">
          <span className="muted">Memory (in-browser, last 2000 entries)</span>
        </Field>
        <div className="section-title">Log Settings</div>
        <Field label="Log violation traffic (Implicit Deny)" help="set fwpolicy-implicit-log enable">
          <Toggle on={g('fwpolicy-implicit-log')} onChange={(v) => set('fwpolicy-implicit-log', v)} />
        </Field>
        <Field label="Local traffic: allowed" help="set local-in-allow enable: log admin access and pings to the FortiGate itself">
          <Toggle on={g('local-in-allow')} onChange={(v) => set('local-in-allow', v)} />
        </Field>
        <Field label="Local traffic: denied" help="set local-in-deny-unicast enable: log blocked attempts to reach the FortiGate">
          <Toggle on={g('local-in-deny-unicast')} onChange={(v) => set('local-in-deny-unicast', v)} />
        </Field>
        <Field label="Resolve hostnames" help="set resolve-ip enable">
          <Toggle on={g('resolve-ip')} onChange={(v) => set('resolve-ip', v)} />
        </Field>
        <RemoteSyslogSection />
      </div>
    </div>
  );
}
