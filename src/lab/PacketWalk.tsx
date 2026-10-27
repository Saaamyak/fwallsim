import { Check, Info, Minus, X } from 'lucide-react';
import { useStore } from '../store';
import { gobj } from '../engine/config';
import type { SimResult } from '../engine/runtime';

function useSelected(): SimResult | undefined {
  const history = useStore((s) => s.runtime.history);
  const sel = useStore((s) => s.ui.selectedResult);
  return history.find((h) => h.id === sel) ?? history[0];
}

const ICON = { ok: <Check size={14} />, fail: <X size={14} />, info: <Info size={14} />, skip: <Minus size={14} /> };

export function PacketWalk() {
  const r = useSelected();
  if (!r) return <div className="empty">Send some traffic first. The step-by-step path through the firewall will appear here.</div>;
  return (
    <div className="walk">
      <div style={{ marginBottom: 8 }}>
        <b>{r.label}</b> · <span className={r.ok ? 'ok-text' : 'err-text'}>{r.summary}</span>
      </div>
      {r.steps.map((s, i) => (
        <div className="walk-step" key={i}>
          <div className={`walk-dot ${s.status}`}>{ICON[s.status]}</div>
          <div>
            <div className="walk-title">
              {s.title} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>[{s.stage}]</span>
            </div>
            <div className="walk-detail">{s.detail}</div>
            {s.lines && s.lines.length > 0 && (
              <div className="walk-lines mono">
                {s.lines.map((l, j) => (
                  <div key={j}>{l}</div>
                ))}
              </div>
            )}
            {s.hint && <div className="walk-hint">💡 {s.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DebugFlow() {
  const r = useSelected();
  const host = useStore((s) => gobj(s.config, 'system global', 'hostname'));
  if (!r) return <div className="console">{`${host} # diagnose debug flow trace start 10\n\n(no packets captured yet — send traffic from the Traffic Generator)`}</div>;
  const header = [
    `${host} # diagnose debug flow filter clear`,
    `${host} # diagnose debug flow show function-name enable`,
    `${host} # diagnose debug flow trace start 10`,
    `${host} # diagnose debug enable`,
    '',
  ];
  const body = r.debug.length ? r.debug : ['(the packet never reached the FortiGate, so no debug output was produced — see Packet Walk)'];
  return <div className="console">{[...header, ...body, '', `${host} # diagnose debug disable`].join('\n')}</div>;
}
