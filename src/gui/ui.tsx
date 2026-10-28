import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRightLeft, Ban, Check, Clock, Globe, Layers, Network, Server, X, Box, Shuffle, Database, ChevronDown, User, Users, HardDrive } from 'lucide-react';

export function Field({ label, children, help, err }: { label: ReactNode; children: ReactNode; help?: ReactNode; err?: string | null }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>
        {children}
        {err ? <div className="err">{err}</div> : help ? <div className="help">{help}</div> : null}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange?: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <span className={`toggle ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`} onClick={() => !disabled && onChange?.(!on)}>
      <span className="track" />
      {label}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, className = '' }: { value: T; options: { v: T; label: ReactNode; cls?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`seg ${className}`}>
      {options.map((o) => (
        <button key={o.v} type="button" className={`${value === o.v ? 'on' : ''} ${o.cls ?? ''}`} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="section-title">{title}</div>
      {children}
    </>
  );
}

export function Modal({ title, children, onClose, footer, wide }: { title: ReactNode; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-hdr">
          {title}
          <span style={{ flex: 1 }} />
          <button className="hdr-btn" style={{ color: 'inherit' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Confirm({ msg, onYes, onNo, yesLabel = 'OK' }: { msg: ReactNode; onYes: () => void; onNo: () => void; yesLabel?: string }) {
  return (
    <Modal
      title="Confirm"
      onClose={onNo}
      footer={
        <>
          <button className="btn primary" onClick={onYes}>
            {yesLabel}
          </button>
          <button className="btn" onClick={onNo}>
            Cancel
          </button>
        </>
      }
    >
      {msg}
    </Modal>
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  sep?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const h = () => onClose();
    window.addEventListener('click', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('click', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [onClose]);
  const top = Math.min(y, window.innerHeight - items.length * 30 - 20);
  return (
    <div className="ctx-menu" style={{ left: Math.min(x, window.innerWidth - 220), top }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="sep" />
        ) : (
          <div
            key={i}
            className="mi"
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            {it.icon}
            {it.label}
          </div>
        ),
      )}
    </div>
  );
}

export function Dropdown({ label, items, className = 'btn', right }: { label: ReactNode; items: MenuItem[]; className?: string; right?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button className={className} onClick={() => setOpen(!open)}>
        {label} <ChevronDown size={13} />
      </button>
      {open && (
        <div className={`dropdown-menu ${right ? 'right' : ''}`}>
          {items.map((it, i) =>
            it.sep ? (
              <div key={i} className="ctx-menu sep" style={{ position: 'static', border: 0, boxShadow: 'none', minWidth: 0, padding: 0, height: 1, background: 'var(--border)', margin: '4px 0' }} />
            ) : it.onClick ? (
              <div
                key={i}
                className="mi"
                onClick={() => {
                  setOpen(false);
                  it.onClick!();
                }}
              >
                {it.icon}
                {it.label}
              </div>
            ) : (
              <div key={i} className="mh">
                {it.label}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------- chips ----------

export type ChipKind = 'intf' | 'zone' | 'addr' | 'grp' | 'vip' | 'svc' | 'svcgrp' | 'sched' | 'pool' | 'any' | 'user' | 'usergrp' | 'authsrv';

const CHIP_ICON: Record<ChipKind, ReactNode> = {
  intf: <Network size={13} color="#3b7dbf" />,
  zone: <Layers size={13} color="#8e5bb5" />,
  addr: <Box size={13} color="#2f8f5b" />,
  grp: <Database size={13} color="#2f8f5b" />,
  vip: <Shuffle size={13} color="#c0702a" />,
  svc: <Server size={13} color="#5a6b8c" />,
  svcgrp: <Layers size={13} color="#5a6b8c" />,
  sched: <Clock size={13} color="#6b7a7c" />,
  pool: <ArrowRightLeft size={13} color="#c0702a" />,
  any: <Globe size={13} color="#6b7a7c" />,
  user: <User size={13} color="#2d7fbf" />,
  usergrp: <Users size={13} color="#2d7fbf" />,
  authsrv: <HardDrive size={13} color="#8e5bb5" />,
};

export function Chip({ kind, name }: { kind: ChipKind; name: string }) {
  return (
    <span className="chip">
      {CHIP_ICON[kind]}
      {name}
    </span>
  );
}

export function ChipList({ kind, names, kindOf }: { kind?: ChipKind; names: string[]; kindOf?: (n: string) => ChipKind }) {
  return (
    <div className="chips">
      {names.map((n) => (
        <Chip key={n} kind={kindOf ? kindOf(n) : kind ?? 'addr'} name={n} />
      ))}
    </div>
  );
}

export const ActionCell = ({ action }: { action: string }) =>
  action === 'accept' ? (
    <span className="act-accept">
      <Check size={14} /> ACCEPT
    </span>
  ) : (
    <span className="act-deny">
      <Ban size={14} /> DENY
    </span>
  );

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtTime(t: number, withDate = true): string {
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return withDate ? `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${time}` : time;
}

export function fmtAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
  if (s < 3600) return `${Math.floor(s / 60)} minute${s < 120 ? '' : 's'} ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour${s < 7200 ? '' : 's'} ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(d).padStart(2, '0')}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Screen widths where the layout changes (keep in step with the @media rules in styles.css). */
export const TABLET = '(max-width: 1024px)';
export const PHONE = '(max-width: 760px)';

/** True while the media query matches; updates when the window is resized or rotated. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function EditPage({ title, children, side, onOk, onCancel, okLabel = 'OK' }: { title: ReactNode; children: ReactNode; side?: ReactNode; onOk: () => void; onCancel: () => void; okLabel?: string }) {
  return (
    <div className="page">
      <div className="page-title">{title}</div>
      <div className="edit-page">
        <div className="form-card">
          {children}
          <div className="form-footer">
            <button className="btn primary" onClick={onOk}>
              {okLabel}
            </button>
            <button className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
        {side}
      </div>
    </div>
  );
}

export const X_ICON = X;

/** Keeps one broken page from blanking the whole GUI: shows the error and a way back. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="page-title">Something went wrong on this page</div>
        <p className="err-text">{this.state.error.message}</p>
        <p className="muted">The rest of FWallSim still works. Your configuration was not changed by this error.</p>
        <button className="btn primary" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

