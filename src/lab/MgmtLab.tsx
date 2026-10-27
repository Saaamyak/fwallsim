import { useState } from 'react';
import { CheckCircle, Trash2, XCircle } from 'lucide-react';
import { clearSyslog, snmpWalkFromNms, useStore } from '../store';
import type { SnmpResult } from '../engine/mgmt';

export function MgmtLab() {
  const syslog = useStore((s) => s.runtime.syslog) ?? [];
  const [community, setCommunity] = useState('fwallsim-ro');
  const [res, setRes] = useState<SnmpResult | null>(null);
  return (
    <div className="lab-grid">
      <div className="lab-form">
        <b>NMS-Server (10.10.10.30): SNMP poll</b>
        <div className="muted" style={{ fontSize: 11, margin: '4px 0 8px' }}>
          Runs <span className="mono">snmpwalk -v2c -c {community || '…'} 10.10.10.1</span> against the FortiGate's dmz address.
        </div>
        <div className="row">
          <label>Community</label>
          <input className="inp" value={community} onChange={(e) => setCommunity(e.target.value)} />
        </div>
        <div className="row">
          <span />
          <button className="btn primary" onClick={() => setRes(snmpWalkFromNms(community))}>
            Run snmpwalk
          </button>
        </div>
        {res && (
          <div className="walk-lines">
            <div className={res.ok ? 'ok-text' : 'err-text'} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
              {res.ok ? <CheckCircle size={14} /> : <XCircle size={14} />} {res.ok ? 'Response received' : res.reason}
            </div>
            {res.lines.map((l, i) => (
              <div key={i} className="mono" style={{ fontSize: 11 }}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          <b>NMS-Server: received syslog ({syslog.length})</b>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={clearSyslog} disabled={!syslog.length}>
            <Trash2 size={12} /> Clear
          </button>
        </div>
        <div className="console" style={{ flex: 1, fontSize: 11 }}>
          {syslog.length ? syslog.join('\n') : 'Nothing received yet. Configure Log & Report > Log Settings > Remote Logging (server 10.10.10.30), then generate traffic or log in/out.'}
        </div>
      </div>
    </div>
  );
}
