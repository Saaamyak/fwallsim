import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Cpu, MemoryStick, Activity, Server, Users, Award } from 'lucide-react';
import { navigate, useStore } from '../../store';
import { gobj } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { FW_BUILD, FW_VERSION, MODEL } from '../../engine/serialize';
import { fmtTime, fmtUptime, useNow } from '../ui';

function Spark({ data, max }: { data: number[]; max: number }) {
  const w = 300;
  const h = 46;
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - (Math.min(v, max) / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="var(--accent-soft)" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

function useSeries(value: number, n = 40) {
  const [s, setS] = useState<number[]>(() => Array(n).fill(value));
  const v = useRef(value);
  v.current = value;
  useEffect(() => {
    const t = setInterval(() => setS((prev) => [...prev.slice(1), v.current]), 2000);
    return () => clearInterval(t);
  }, []);
  return s;
}

export function StatusDashboard() {
  const config = useStore((s) => s.config);
  const rt = useStore((s) => s.runtime);
  const auth = useStore((s) => s.auth);
  const now = useNow(1000);
  const net = useMemo(() => buildNet(config), [config]);
  const recent = rt.history.filter((h) => now - h.time < 10000).length;
  const cpu = Math.min(95, 2 + recent * 6 + (now % 7000 < 3500 ? 1 : 0));
  const mem = 41 + Math.min(10, rt.sessions.length * 0.3);
  const cpuS = useSeries(cpu);
  const memS = useSeries(mem);
  const sesS = useSeries(rt.sessions.length);
  const wan = net.ifs['wan1'];
  const ports = ['wan1', 'wan2', 'dmz', 'internal1', 'internal2', 'internal3', 'internal4', 'internal5'];

  return (
    <div className="page">
      <div className="page-title">Dashboard · Status</div>
      <div className="widgets">
        <div className="widget">
          <div className="widget-hdr">
            <Server size={15} /> System Information
          </div>
          <div className="widget-body">
            <div className="wrow">
              <span>Hostname</span>
              <a onClick={() => navigate('sys-settings')}>{gobj(config, 'system global', 'hostname')}</a>
            </div>
            <div className="wrow">
              <span>Serial Number</span>
              <span className="mono">{MODEL}TK26000001</span>
            </div>
            <div className="wrow">
              <span>Firmware</span>
              <span>
                v{rt.firmware?.version ?? FW_VERSION.slice(1)} build{rt.firmware?.build ?? FW_BUILD} <a onClick={() => navigate('sys-firmware')}>Firmware</a>
              </span>
            </div>
            <div className="wrow">
              <span>Mode</span>
              <span>NAT (Flow-based)</span>
            </div>
            <div className="wrow">
              <span>System Time</span>
              <span>{fmtTime(now)}</span>
            </div>
            <div className="wrow">
              <span>Uptime</span>
              <span className="mono">{fmtUptime(Math.max(0, now - rt.bootTime))}</span>
            </div>
            <div className="wrow">
              <span>WAN IP</span>
              <span>{wan?.ipStr ? `${wan.ipStr} (wan1, DHCP)` : <span className="err-text">Unavailable</span>}</span>
            </div>
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <Award size={15} /> Licenses
          </div>
          <div className="widget-body">
            {['FortiCare Support', 'Firmware & General Updates', 'IPS', 'AntiVirus', 'Web Filtering', 'Outbreak Prevention'].map((l) => (
              <div className="wrow" key={l}>
                <span>{l}</span>
                <span className="ok-text" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <CheckCircle size={14} /> Licensed
                </span>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Simulated: all services always show as licensed.
            </div>
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <Users size={15} /> Administrators
          </div>
          <div className="widget-body">
            <div className="big-num">1</div>
            <div className="wrow">
              <span>HTTPS</span>
              <span>
                {auth.user} (super_admin) · since {fmtTime(auth.since, false)}
              </span>
            </div>
            <div className="wrow">
              <span>Idle timeout</span>
              <span>{gobj(config, 'system global', 'admintimeout')} minutes</span>
            </div>
          </div>
        </div>

        <div className="widget span2">
          <div className="widget-hdr">{MODEL}: front panel</div>
          <div className="widget-body">
            <div className="faceplate">
              <span className="model">{MODEL}</span>
              {ports.map((p) => {
                const i = net.ifs[p];
                const cls = !i ? '' : !i.adminUp ? 'admin-down' : i.link ? 'up' : '';
                return (
                  <div key={p} className="port" title={`${p}: ${!i ? 'n/a' : !i.adminUp ? 'administratively down' : i.link ? 'link up' : 'no cable'}`} onClick={() => navigate('net-interfaces')}>
                    <div className={`jack ${cls}`} />
                    <span>{p.replace('internal', '')}</span>
                  </div>
                );
              })}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Green = link up · Grey = no cable · Red = administratively down. Ports 1–5 form the "internal" hardware switch.
            </div>
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <Cpu size={15} /> CPU
          </div>
          <div className="widget-body">
            <div className="big-num">{cpu}%</div>
            <Spark data={cpuS} max={100} />
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <MemoryStick size={15} /> Memory
          </div>
          <div className="widget-body">
            <div className="big-num">{mem.toFixed(0)}%</div>
            <Spark data={memS} max={100} />
          </div>
        </div>

        <div className="widget">
          <div className="widget-hdr">
            <Activity size={15} /> Sessions
          </div>
          <div className="widget-body">
            <div className="big-num">
              <a onClick={() => navigate('dash-sessions')}>{rt.sessions.length}</a>
            </div>
            <Spark data={sesS} max={Math.max(10, ...sesS)} />
          </div>
        </div>
      </div>
    </div>
  );
}
