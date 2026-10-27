import { useMemo } from 'react';
import { setUi, sendTraffic, updateLab, useStore } from '../store';
import { buildNet } from '../engine/net';
import { ISPS } from '../engine/topology';
import { Toggle } from '../gui/ui';

export function WanLab() {
  const config = useStore((s) => s.config);
  const lab = useStore((s) => s.runtime.lab);
  const net = useMemo(() => buildNet(config), [config, lab]); // eslint-disable-line
  const test = (src: string, dst: string, proto: 'tcp' | 'icmp', dport: number, label: string) => {
    sendTraffic({ srcHost: src, dst, proto, dport, label });
    setUi({ dockTab: 'walk' });
  };

  return (
    <div className="lab-grid">
      <div className="lab-form">
        <b>Internet links</b>
        {Object.entries(ISPS).map(([seg, isp]) => {
          const i = net.ifs[seg];
          return (
            <div key={seg} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  <b>{seg}</b> → {isp.name} ({isp.net}/{isp.prefix})
                </span>
                <span className={i?.up ? 'ok-text' : 'muted'}>{i?.up ? `up ${i.ipStr || ''}` : 'down'}</span>
              </div>
              {seg === 'wan2' && (
                <div style={{ marginTop: 4 }}>
                  <Toggle on={lab.wan2Cable} onChange={(v) => updateLab((l) => ({ ...l, wan2Cable: v }))} label="Cable plugged into ISP2" />
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                <Toggle on={!!lab.ispDown?.[seg]} onChange={(v) => updateLab((l) => ({ ...l, ispDown: { ...l.ispDown, [seg]: v } }))} label={<span className={lab.ispDown?.[seg] ? 'err-text' : ''}>{isp.name} outage (link stays up)</span>} />
              </div>
              <div className="row" style={{ marginTop: 6, marginBottom: 0 }}>
                <label>Latency</label>
                <span>
                  <input type="range" min={1} max={150} value={lab.ispLatency?.[seg] ?? 5} onChange={(e) => updateLab((l) => ({ ...l, ispLatency: { ...l.ispLatency, [seg]: Number(e.target.value) } }))} /> {lab.ispLatency?.[seg] ?? 5} ms
                </span>
              </div>
              <div className="row" style={{ marginBottom: 0 }}>
                <label>Packet loss</label>
                <span>
                  <input type="range" min={0} max={50} value={lab.ispLoss?.[seg] ?? 0} onChange={(e) => updateLab((l) => ({ ...l, ispLoss: { ...l.ispLoss, [seg]: Number(e.target.value) } }))} /> {lab.ispLoss?.[seg] ?? 0}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <b>SD-WAN health</b>
        {!net.sdwan.enabled && <p className="muted">SD-WAN is disabled (Network &gt; SD-WAN). Without it, an ISP outage is invisible to the FortiGate: the link stays up, so traffic keeps going to the dead ISP.</p>}
        {net.sdwan.health.map((h) => (
          <div key={h.name} style={{ marginTop: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {h.name} ({h.protocol} {h.server})
            </div>
            {h.members.map((x) => (
              <div key={x.seq} style={{ fontSize: 12 }}>
                <b>{x.intf}</b> {x.alive ? <span className="ok-text">alive</span> : <span className="err-text">dead</span>} · {x.latency} ms · jitter {x.jitter} · loss {x.loss}% · SLA {x.sla.map((ok, k) => `#${k + 1} ${ok ? '✔' : '✖'}`).join(' ')}
              </div>
            ))}
          </div>
        ))}
        <div className="presets" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => test('pc1', '8.8.8.8', 'icmp', 0, 'PC1 → 8.8.8.8')}>
            PC1 → 8.8.8.8
          </button>
          <button className="btn sm" onClick={() => test('pc2', '8.8.8.8', 'icmp', 0, 'PC2 → 8.8.8.8')}>
            PC2 → 8.8.8.8
          </button>
          <button className="btn sm" onClick={() => test('pc1', 'www.youtube.com', 'tcp', 443, 'PC1 → YouTube')}>
            PC1 → YouTube
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 12 }}>
          <b>Dynamic routing</b>
          <div className="muted">
            BGP: {net.bgp.enabled ? net.bgp.neighbors.map((n) => `${n.ip} ${n.state}`).join(', ') || 'no neighbors' : 'disabled'}
            <br />
            OSPF: {net.ospf.enabled ? net.ospf.neighbors.map((n) => `${n.routerId} ${n.state}`).join(', ') || 'no neighbors' : 'disabled'}
          </div>
        </div>
      </div>
    </div>
  );
}
