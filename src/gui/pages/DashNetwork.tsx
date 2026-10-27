import { useMemo } from 'react';
import { Route, Network, Laptop } from 'lucide-react';
import { useStore } from '../../store';
import { buildNet, routeCode } from '../../engine/net';
import { intToIp } from '../../engine/ip';
import { fmtBytes } from '../ui';

export function NetworkDashboard() {
  const config = useStore((s) => s.config);
  const ifStats = useStore((s) => s.runtime.ifStats);
  const net = useMemo(() => buildNet(config), [config]);
  const routes = [...net.routes].sort((a, b) => b.prefix - a.prefix || a.net - b.net || a.distance - b.distance);
  const leases = net.hosts.filter((h) => h.dhcp);

  return (
    <div className="page">
      <div className="page-title">Dashboard · Network</div>
      <div className="widgets" style={{ gridTemplateColumns: '1fr' }}>
        <div className="widget">
          <div className="widget-hdr">
            <Route size={15} /> Static &amp; Dynamic Routing
            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
              (equivalent of: get router info routing-table all / database)
            </span>
          </div>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Network</th>
                  <th>Gateway IP</th>
                  <th>Interfaces</th>
                  <th className="num">Distance</th>
                  <th className="num">Priority</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr className="row" key={i}>
                    <td className="mono">
                      {intToIp(r.net)}/{r.prefix}
                    </td>
                    <td className="mono">{r.gateway ?? '0.0.0.0'}</td>
                    <td>{r.device}</td>
                    <td className="num">{r.distance}</td>
                    <td className="num">{r.type === 'connected' ? '' : r.priority}</td>
                    <td>
                      <span className="mono">{routeCode(r)}</span> {r.type === 'connected' ? 'Connected' : r.type === 'dhcp' ? 'Static (DHCP)' : r.type === 'bgp' ? 'BGP' : r.type === 'ospf' ? `OSPF (metric ${r.metric})` : r.blackhole ? 'Static (blackhole)' : 'Static'}
                    </td>
                    <td>{r.active ? <span className="badge ok">Active</span> : <span className="badge grey" title={r.reason}>Inactive: {r.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {routes.length === 0 && <div className="empty">The routing table is empty.</div>}
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <Laptop size={15} /> DHCP
          </div>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP Address</th>
                  <th>Interface</th>
                  <th>Gateway / DNS handed out</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {leases.map((h) => (
                  <tr className="row" key={h.host.id}>
                    <td>{h.host.name}</td>
                    <td className="mono">{h.ip ?? '-'}</td>
                    <td>{h.logical}</td>
                    <td className="mono">
                      {h.gw ?? '-'} / {h.dns ?? '-'}
                    </td>
                    <td>{h.ok ? <span className="badge ok">Leased</span> : <span className="badge err" title={h.note}>{h.note}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <Network size={15} /> Interface traffic (since boot)
          </div>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Link</th>
                  <th>IP</th>
                  <th className="num">RX bytes</th>
                  <th className="num">TX bytes</th>
                  <th className="num">RX packets</th>
                  <th className="num">TX packets</th>
                </tr>
              </thead>
              <tbody>
                {net.ifList
                  .filter((i) => !i.memberOf)
                  .map((i) => {
                    const s = ifStats[i.name] ?? { rxB: 0, txB: 0, rxP: 0, txP: 0 };
                    return (
                      <tr className="row" key={i.name}>
                        <td>{i.name}</td>
                        <td>{i.up ? <span className="badge ok">up</span> : <span className="badge grey">{i.adminUp ? 'no link' : 'admin down'}</span>}</td>
                        <td className="mono">{i.ipStr ? `${i.ipStr}/${i.prefix}` : '-'}</td>
                        <td className="num">{fmtBytes(s.rxB)}</td>
                        <td className="num">{fmtBytes(s.txB)}</td>
                        <td className="num">{s.rxP}</td>
                        <td className="num">{s.txP}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
