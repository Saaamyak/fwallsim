import { LogOut } from 'lucide-react';
import { firewallLogout, useStore } from '../../store';
import { Chip, fmtTime, useNow } from '../ui';

export function UserMonitorPage() {
  const auth = useStore((s) => s.runtime.lab.auth);
  const now = useNow(1000);
  const rows = Object.values(auth);
  return (
    <div className="page">
      <div className="page-title">Firewall User Monitor</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>User Name</th>
              <th>User Group</th>
              <th>IP Address</th>
              <th>Device</th>
              <th>Method</th>
              <th>Logged in</th>
              <th className="num">Expires in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr className="row" key={a.ip}>
                <td>
                  <Chip kind="user" name={a.user} />
                </td>
                <td>{a.groups.length ? a.groups.map((g) => <Chip key={g} kind="usergrp" name={g} />) : <span className="muted">(none)</span>}</td>
                <td className="mono">{a.ip}</td>
                <td>{a.host}</td>
                <td>{a.method === 'local' ? 'Local' : `${a.method.toUpperCase()} (${a.server})`}</td>
                <td className="mono">{fmtTime(a.time)}</td>
                <td className="num">{Math.max(0, Math.round((a.expires - now) / 1000))} s</td>
                <td>
                  <button className="btn sm danger" onClick={() => firewallLogout(a.ip)}>
                    <LogOut size={12} /> Deauthenticate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No authenticated users. Log in a lab PC from Lab &gt; Users.</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        The FortiGate remembers a login per <b>source IP</b>. While an IP is listed here, its traffic matches identity-based policies for the user's groups. CLI: <span className="mono">diagnose firewall auth list</span>.
      </p>
    </div>
  );
}
