import { useMemo, useState } from 'react';
import { navigate, toast, updateConfig, useStore } from '../../store';
import { def, entries, find, list, nextKey, str, tableOf } from '../../engine/config';
import { buildNet } from '../../engine/net';
import { sdwanConfig } from '../../engine/sdwan';
import { fmtIpMask, isIp, parseIpMask, intToIp } from '../../engine/ip';
import { ObjectList, type Col } from '../ObjectList';
import { EditPage, Field, Seg } from '../ui';

const PAGE = 'net-static';

interface Row {
  key: string;
  dst: string;
  gw: string;
  dev: string;
  distance: string;
  priority: string;
  status: boolean;
  comment: string;
  active: boolean;
  reason?: string;
}

export function StaticRoutesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <RouteEdit id={editKey} /> : <RouteList />;
}

function RouteList() {
  const config = useStore((s) => s.config);
  const net = useMemo(() => buildNet(config), [config]);
  const R = def('router static');
  const rows: Row[] = entries(config, 'router static').map((e) => {
    const s = (n: string) => str(R, e.f, n);
    const st = net.routes.find((r) => r.seq === e.key);
    const n = parseIpMask(s('dst'));
    return {
      key: e.key,
      dst: n ? `${intToIp(n.ip)}/${n.prefix}` : s('dst'),
      gw: s('blackhole') === 'enable' ? '' : s('gateway'),
      dev: s('blackhole') === 'enable' ? 'Blackhole' : list(R, e.f, 'sdwan-zone')[0] ? `SD-WAN zone ${list(R, e.f, 'sdwan-zone')[0]}` : s('device'),
      distance: s('distance'),
      priority: s('priority'),
      status: s('status') === 'enable',
      comment: s('comment'),
      active: !!st?.active,
      reason: st?.reason,
    };
  });
  const cols: Col<Row>[] = [
    { title: 'Destination', render: (r) => <span className="mono">{r.dst}</span> },
    { title: 'Gateway IP', render: (r) => <span className="mono">{r.gw}</span> },
    { title: 'Interface', render: (r) => r.dev },
    { title: 'Distance', className: 'num', render: (r) => r.distance },
    { title: 'Priority', className: 'num', render: (r) => r.priority },
    {
      title: 'Status',
      render: (r) => (!r.status ? <span className="badge grey">Disabled</span> : r.active ? <span className="badge ok">Active</span> : <span className="badge warn" title={r.reason}>Inactive{r.reason ? `: ${r.reason}` : ''}</span>),
    },
    { title: 'Comments', render: (r) => r.comment },
  ];
  return (
    <div className="page">
      <div className="page-title">Static Routes</div>
      <ObjectList<Row>
        groups={[{ title: '', rows }]}
        cols={cols}
        onCreate={() => navigate(PAGE, 'new')}
        onEdit={(r) => navigate(PAGE, r.key)}
        onDelete={(r) => updateConfig((c) => (tableOf(c, 'router static').entries = entries(c, 'router static').filter((e) => e.key !== r.key)), `Delete router.static ${r.key}`)}
        onClone={(r) =>
          updateConfig((c) => {
            const src = find(c, 'router static', r.key)!;
            tableOf(c, 'router static').entries.push({ key: nextKey(c, 'router static'), f: { ...structuredClone(src.f), status: 'disable' } });
          }, `Clone router.static ${r.key}`)
        }
        rowClass={(r) => (r.status ? '' : 'disabled')}
        search={(r, q) => `${r.dst} ${r.gw} ${r.dev} ${r.comment}`.toLowerCase().includes(q)}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        The default route learned by DHCP on wan1 does not appear here. See it under Dashboard &gt; Network &gt; Routing. Lower distance wins for the same prefix; for equal distance, lower priority wins.
      </p>
    </div>
  );
}

function RouteEdit({ id }: { id: string }) {
  const config = useStore((s) => s.config);
  const isNew = id === 'new';
  const R = def('router static');
  const e = isNew ? undefined : find(config, 'router static', id);
  const s = (n: string) => (e ? str(R, e.f, n) : (R.fields.find((x) => x.name === n)?.default as string) ?? '');
  const n0 = parseIpMask(s('dst'));
  const devs = buildNet(config).ifList.filter((i) => !i.memberOf).map((i) => ({ key: i.name }));
  const sw = sdwanConfig(config);
  const [f, setF] = useState({
    dst: n0 ? `${intToIp(n0.ip)}/${n0.prefix}` : '0.0.0.0/0',
    gw: s('gateway'),
    dev: s('blackhole') === 'enable' ? '__blackhole' : e && list(R, e.f, 'sdwan-zone')[0] ? `__sdwan:${list(R, e.f, 'sdwan-zone')[0]}` : s('device') || 'wan1',
    distance: s('distance'),
    priority: s('priority'),
    comment: s('comment'),
    status: s('status'),
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const save = () => {
    const n = parseIpMask(f.dst);
    if (!n) return setErr('Enter a valid destination subnet, e.g. 10.20.0.0/16 or 0.0.0.0/0.');
    const bh = f.dev === '__blackhole';
    const zone = f.dev.startsWith('__sdwan:') ? f.dev.slice(8) : '';
    if (!bh && !zone && !isIp(f.gw)) return setErr('Enter a valid gateway address.');
    const d = Number(f.distance);
    if (!(d >= 1 && d <= 255)) return setErr('Administrative distance must be 1–255.');
    const key = isNew ? nextKey(config, 'router static') : id;
    updateConfig(
      (c) => {
        let row = find(c, 'router static', key);
        if (!row) {
          row = { key, f: {} };
          tableOf(c, 'router static').entries.push(row);
        }
        row.f = {
          ...(f.status !== 'enable' ? { status: 'disable' } : {}),
          dst: fmtIpMask({ ip: n.ip, prefix: n.prefix }),
          ...(bh ? { blackhole: 'enable' } : zone ? { 'sdwan-zone': [zone] } : { gateway: f.gw, device: f.dev }),
          distance: f.distance,
          ...(f.priority !== '1' ? { priority: f.priority } : {}),
          ...(f.comment ? { comment: f.comment } : {}),
        };
      },
      `${isNew ? 'Add' : 'Edit'} router.static ${key}`,
    );
    toast('Static route saved');
    navigate(PAGE);
  };

  return (
    <EditPage title={isNew ? 'New Static Route' : `Edit Static Route ${id}`} onOk={save} onCancel={() => navigate(PAGE)}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Destination" help="Subnet: 0.0.0.0/0 is the default route">
        <input className="inp" value={f.dst} onChange={(e) => up('dst', e.target.value)} />
      </Field>
      <Field label="Interface">
        <select className="sel" value={f.dev} onChange={(e) => up('dev', e.target.value)}>
          {devs.map((d) => (
            <option key={d.key}>{d.key}</option>
          ))}
          {sw.enabled && sw.zones.map((z) => (
            <option key={z} value={`__sdwan:${z}`}>
              SD-WAN zone: {z}
            </option>
          ))}
          <option value="__blackhole">Blackhole</option>
        </select>
      </Field>
      {f.dev !== '__blackhole' && !f.dev.startsWith('__sdwan:') && (
        <Field label="Gateway Address" help="Must be inside the subnet of the chosen interface, or the route stays inactive.">
          <input className="inp" value={f.gw} onChange={(e) => up('gw', e.target.value)} placeholder="203.0.113.1" />
        </Field>
      )}
      <Field label="Administrative Distance">
        <input className="inp sm" value={f.distance} onChange={(e) => up('distance', e.target.value)} />
      </Field>
      <Field label="Priority" help="Advanced: tie-breaker between routes with the same distance (lower wins).">
        <input className="inp sm" value={f.priority} onChange={(e) => up('priority', e.target.value)} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={f.comment} onChange={(e) => up('comment', e.target.value)} />
      </Field>
      <Field label="Status">
        <Seg
          value={f.status}
          onChange={(v) => up('status', v)}
          options={[
            { v: 'enable', label: 'Enabled' },
            { v: 'disable', label: 'Disabled' },
          ]}
        />
      </Field>
    </EditPage>
  );
}
