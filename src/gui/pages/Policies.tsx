import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, FileSearch, GripVertical, Pencil, Plus, Power, RotateCcw, Search, Trash2 } from 'lucide-react';
import { clearPolicyCounters, navigate, setUi, toast, updateConfig, useStore } from '../../store';
import type { Config } from '../../engine/types';
import { entries, find, gobj, newUuid, nextKey, objectOf, tableOf } from '../../engine/config';
import { policies, type PolicyView } from '../../engine/views';
import { policyLookup } from '../../engine/packet';
import type { Proto } from '../../engine/objects';
import { ActionCell, ChipList, Confirm, ContextMenu, Field, Modal, Seg, fmtAgo, fmtBytes, type MenuItem } from '../ui';
import { kindOfName, ifaceOptions } from '../picker';
import { PolicyEdit } from './PolicyEdit';

export const POLICY_PAGE = 'pol-policy';

export function PoliciesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <PolicyEdit editKey={editKey} /> : <PolicyList />;
}

function movePolicy(c: Config, from: string, to: string, where: 'before' | 'after') {
  const t = tableOf(c, 'firewall policy');
  const i = t.entries.findIndex((e) => e.key === from);
  if (i < 0) return;
  const [row] = t.entries.splice(i, 1);
  let j = t.entries.findIndex((e) => e.key === to);
  if (j < 0) j = t.entries.length;
  t.entries.splice(where === 'before' ? j : j + 1, 0, row);
}

function PolicyList() {
  const config = useStore((s) => s.config);
  const stats = useStore((s) => s.runtime.policyStats);
  const sessions = useStore((s) => s.runtime.sessions);
  const [view, setView] = useState<'pair' | 'seq'>('pair');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [lookup, setLookup] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const implicitLog = gobj(config, 'log setting', 'fwpolicy-implicit-log') === 'enable';

  const all = policies(config);
  const rows = all.filter((p) => !q || [p.id, p.name, ...p.srcintf, ...p.dstintf, ...p.srcaddr, ...p.dstaddr, ...p.service, p.comments].join(' ').toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => {
    if (view === 'seq') return [{ title: '', rows }];
    const g = new Map<string, PolicyView[]>();
    for (const p of rows) {
      const k = `${p.srcintf.join(', ')} → ${p.dstintf.join(', ')}`;
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g.entries()].map(([title, rows]) => ({ title, rows }));
  }, [rows, view]);
  const kind = (n: string) => kindOfName(config, n);
  const selP = all.find((p) => p.id === sel);

  const toggleStatus = (id: string) =>
    updateConfig((c) => {
      const e = find(c, 'firewall policy', id)!;
      if (e.f.status === 'disable') delete e.f.status;
      else e.f.status = 'disable';
    }, `Edit firewall.policy ${id} status`);

  const clone = (id: string) => {
    updateConfig((c) => {
      const src = find(c, 'firewall policy', id)!;
      const key = nextKey(c, 'firewall policy');
      const f = structuredClone(src.f);
      f.uuid = newUuid();
      f.name = `${typeof f.name === 'string' && f.name ? f.name : 'policy'}_copy`.slice(0, 35);
      f.status = 'disable';
      tableOf(c, 'firewall policy').entries.push({ key, f });
      movePolicy(c, key, id, 'after');
    }, `Clone firewall.policy ${id}`);
    toast('Policy cloned below the original (disabled). Edit it, then enable it.');
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = all.findIndex((p) => p.id === id);
    const j = i + dir;
    if (j < 0 || j >= all.length) return;
    updateConfig((c) => movePolicy(c, id, all[j].id, dir < 0 ? 'before' : 'after'), `Move firewall.policy ${id} ${dir < 0 ? 'before' : 'after'} ${all[j].id}`);
  };

  const menuItems = (id: string): MenuItem[] => {
    const p = all.find((x) => x.id === id)!;
    return [
      { label: 'Edit', icon: <Pencil size={14} />, onClick: () => navigate(POLICY_PAGE, id) },
      { label: 'Insert empty policy above', icon: <Plus size={14} />, onClick: () => navigate(POLICY_PAGE, `new:before:${id}`) },
      { label: 'Insert empty policy below', icon: <Plus size={14} />, onClick: () => navigate(POLICY_PAGE, `new:after:${id}`) },
      { label: 'Clone (paste below)', icon: <Copy size={14} />, onClick: () => clone(id) },
      { sep: true, label: '' },
      { label: p.status ? 'Disable' : 'Enable', icon: <Power size={14} />, onClick: () => toggleStatus(id) },
      { label: 'Move up', icon: <ArrowUp size={14} />, onClick: () => move(id, -1) },
      { label: 'Move down', icon: <ArrowDown size={14} />, onClick: () => move(id, 1) },
      { sep: true, label: '' },
      {
        label: 'Show matching logs',
        icon: <Eye size={14} />,
        onClick: () => {
          setUi({ logFilter: `policyid=${id}` });
          navigate('log-forward');
        },
      },
      { label: 'Clear counters', icon: <RotateCcw size={14} />, onClick: () => clearPolicyCounters(id) },
      { label: 'Delete', icon: <Trash2 size={14} />, onClick: () => setDel(id) },
    ];
  };

  const cols = 14;
  const renderRow = (p: PolicyView) => {
    const st = stats[p.id];
    const active = sessions.filter((s) => String(s.policyid) === p.id).length;
    return (
      <tr
        key={p.id}
        className={`row ${sel === p.id ? 'selected' : ''} ${p.status ? '' : 'disabled'} ${drag?.over === p.id && drag.from !== p.id ? 'drop-target' : ''}`}
        style={highlight === p.id ? { outline: '2px solid var(--warn)', outlineOffset: -2 } : undefined}
        draggable
        onDragStart={() => setDrag({ from: p.id, over: null })}
        onDragOver={(e) => {
          e.preventDefault();
          if (drag && drag.over !== p.id) setDrag({ ...drag, over: p.id });
        }}
        onDragEnd={() => setDrag(null)}
        onDrop={() => {
          if (drag && drag.from !== p.id) updateConfig((c) => movePolicy(c, drag.from, p.id, 'before'), `Move firewall.policy ${drag.from} before ${p.id}`);
          setDrag(null);
        }}
        onClick={() => setSel(p.id)}
        onDoubleClick={() => navigate(POLICY_PAGE, p.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSel(p.id);
          setMenu({ x: e.clientX, y: e.clientY, id: p.id });
        }}
      >
        <td>
          <span className="chip">
            <GripVertical size={13} className="muted" style={{ cursor: 'grab' }} />
            {p.name || <i className="muted">(unnamed)</i>}
          </span>
        </td>
        <td className="num">{p.id}</td>
        <td>
          <ChipList names={p.srcintf} kindOf={kind} />
        </td>
        <td>
          <ChipList names={p.dstintf} kindOf={kind} />
        </td>
        <td>
          {p.srcaddrNegate && <span className="badge warn">NOT</span>}
          <ChipList names={[...p.srcaddr, ...p.users, ...p.groups]} kindOf={kind} />
        </td>
        <td>
          {p.dstaddrNegate && <span className="badge warn">NOT</span>}
          <ChipList names={p.dstaddr} kindOf={kind} />
        </td>
        <td>{p.schedule && <ChipList names={[p.schedule]} kind="sched" />}</td>
        <td>
          {p.serviceNegate && <span className="badge warn">NOT</span>}
          <ChipList names={p.service} kindOf={kind} />
        </td>
        <td>
          <ActionCell action={p.action} />
        </td>
        <td>{p.action === 'accept' ? (p.nat ? <span className="badge ok">{p.ippool ? p.poolname.join(', ') : 'NAT'}</span> : <span className="badge grey">Disabled</span>) : ''}</td>
        <td>
          <span className="badge grey" title="Security profiles arrive in Phase 4">
            {p.sslProfile}
          </span>
        </td>
        <td>{p.logtraffic === 'all' ? 'All' : p.logtraffic === 'utm' ? 'UTM' : 'Disabled'}</td>
        <td className="num" title={st?.last ? `Last used ${fmtAgo(st.last)}` : 'Never used'}>
          {fmtBytes(st?.bytes ?? 0)}
          {active > 0 && <div className="muted" style={{ fontSize: 11 }}>{active} active</div>}
        </td>
        <td className="num">{st?.hits ?? 0}</td>
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="page-title">Firewall Policy</div>
      <div className="toolbar">
        <button className="btn" onClick={() => navigate(POLICY_PAGE, 'new')}>
          <Plus size={14} /> Create New
        </button>
        <button className="btn" disabled={!sel} onClick={() => sel && navigate(POLICY_PAGE, sel)}>
          <Pencil size={14} /> Edit
        </button>
        <button className="btn danger" disabled={!sel} onClick={() => sel && setDel(sel)}>
          <Trash2 size={14} /> Delete
        </button>
        <button className="btn" onClick={() => setLookup(true)}>
          <FileSearch size={14} /> Policy Lookup
        </button>
        <span className="grow" />
        <Seg
          value={view}
          onChange={setView}
          options={[
            { v: 'pair', label: 'Interface Pair View' },
            { v: 'seq', label: 'By Sequence' },
          ]}
        />
        <div className="search">
          <Search size={14} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">ID</th>
              <th>From</th>
              <th>To</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Schedule</th>
              <th>Service</th>
              <th>Action</th>
              <th>NAT</th>
              <th>Security Profiles</th>
              <th>Log</th>
              <th className="num">Bytes</th>
              <th className="num">Hit Count</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.title || 'seq'}>
                {g.title && (
                  <tr className="grp" onClick={() => setClosed({ ...closed, [g.title]: !closed[g.title] })}>
                    <td colSpan={cols}>
                      {closed[g.title] ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {g.title} ({g.rows.length})
                    </td>
                  </tr>
                )}
                {!closed[g.title] && g.rows.map(renderRow)}
              </Fragment>
            ))}
            <tr className="grp">
              <td colSpan={cols}>Implicit (1)</td>
            </tr>
            <tr
              className={`row ${highlight === '0' ? 'selected' : ''}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, id: '0' });
              }}
            >
              <td>Implicit Deny</td>
              <td className="num">0</td>
              <td>
                <ChipList names={['any']} kind="any" />
              </td>
              <td>
                <ChipList names={['any']} kind="any" />
              </td>
              <td>
                <ChipList names={['all']} kind="any" />
              </td>
              <td>
                <ChipList names={['all']} kind="any" />
              </td>
              <td>
                <ChipList names={['always']} kind="sched" />
              </td>
              <td>
                <ChipList names={['ALL']} kind="any" />
              </td>
              <td>
                <ActionCell action="deny" />
              </td>
              <td />
              <td />
              <td>{implicitLog ? 'All' : 'Disabled'}</td>
              <td className="num">-</td>
              <td className="num">-</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        Policies are evaluated from top to bottom and the <b>first match wins</b>. Drag rows to reorder them. Right-click for more actions (insert, clone, enable/disable, logs). Right-click the Implicit Deny row to log violation traffic.
        {selP && !selP.status && ' The selected policy is disabled and is skipped during lookup.'}
      </p>
      {menu &&
        (menu.id === '0' ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              {
                label: implicitLog ? 'Disable "Log Violation Traffic"' : 'Enable "Log Violation Traffic"',
                icon: <Eye size={14} />,
                onClick: () => updateConfig((c) => (objectOf(c, 'log setting').f['fwpolicy-implicit-log'] = implicitLog ? 'disable' : 'enable'), 'Edit log.setting fwpolicy-implicit-log'),
              },
            ]}
          />
        ) : (
          <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.id)} />
        ))}
      {del && (
        <Confirm
          msg={
            <>
              Delete policy <b>{del}</b> {all.find((p) => p.id === del)?.name}?
            </>
          }
          onNo={() => setDel(null)}
          onYes={() => {
            updateConfig((c) => (tableOf(c, 'firewall policy').entries = entries(c, 'firewall policy').filter((e) => e.key !== del)), `Delete firewall.policy ${del}`);
            clearPolicyCounters(del);
            setDel(null);
            setSel(null);
          }}
        />
      )}
      {lookup && (
        <PolicyLookup
          onClose={() => setLookup(false)}
          onFound={(id) => {
            setHighlight(id);
            setSel(id === '0' ? null : id);
            setTimeout(() => setHighlight(null), 6000);
          }}
        />
      )}
    </div>
  );
}

function PolicyLookup({ onClose, onFound }: { onClose: () => void; onFound: (id: string) => void }) {
  const config = useStore((s) => s.config);
  const [f, setF] = useState({ srcintf: 'internal', proto: 'tcp' as Proto, src: '192.168.1.110', dst: '8.8.8.8', dport: '443' });
  const [res, setRes] = useState<ReturnType<typeof policyLookup> | null>(null);
  const run = () => {
    const r = policyLookup(config, { ...f, dport: Number(f.dport) || 0 });
    setRes(r);
    if (r.policyId) onFound(r.policyId);
  };
  return (
    <Modal
      title="Policy Lookup"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={run}>
            Search
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <Field label="Incoming Interface">
        <select className="sel" value={f.srcintf} onChange={(e) => setF({ ...f, srcintf: e.target.value })}>
          {ifaceOptions(config).map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Protocol">
        <Seg
          value={f.proto}
          onChange={(v) => setF({ ...f, proto: v })}
          options={[
            { v: 'tcp', label: 'TCP' },
            { v: 'udp', label: 'UDP' },
            { v: 'icmp', label: 'ICMP' },
          ]}
        />
      </Field>
      <Field label="Source">
        <input className="inp" value={f.src} onChange={(e) => setF({ ...f, src: e.target.value })} />
      </Field>
      <Field label="Destination">
        <input className="inp" value={f.dst} onChange={(e) => setF({ ...f, dst: e.target.value })} />
      </Field>
      {f.proto !== 'icmp' && (
        <Field label="Destination Port">
          <input className="inp sm" value={f.dport} onChange={(e) => setF({ ...f, dport: e.target.value })} />
        </Field>
      )}
      {res && (
        <div className="walk-lines" style={{ marginTop: 10 }}>
          <div>
            <b>{res.message}</b>
          </div>
          {res.trace.map((t, i) => (
            <div key={i} className="mono">
              {t}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
