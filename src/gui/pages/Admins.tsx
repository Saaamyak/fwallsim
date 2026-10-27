import { useState } from 'react';
import { navigate, useStore } from '../../store';
import type { Fields } from '../../engine/types';
import { def, entries, find, str } from '../../engine/config';
import { fmtIpMask, intToIp, parseIpMask } from '../../engine/ip';
import { PERM_GROUPS, profilePerms, trustedHosts, type Perm } from '../../engine/admin';
import { ObjectList, type Col } from '../ObjectList';
import { EditPage, Field, Section, Seg, Toggle } from '../ui';
import { deleteEntry, nameError, saveEntry } from '../save';

// ---------- Administrators ----------

interface ARow {
  key: string;
  profile: string;
  trusted: string[];
  comments: string;
}

export function AdministratorsPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <AdminEdit name={editKey === 'new' ? '' : editKey} /> : <AdminList />;
}

function AdminList() {
  const config = useStore((s) => s.config);
  const me = useStore((s) => s.auth.user);
  const A = def('system admin');
  const rows: ARow[] = entries(config, 'system admin').map((e) => ({ key: e.key, profile: str(A, e.f, 'accprofile'), trusted: trustedHosts(config, e.key).map((t) => t.replace(' ', '/')), comments: str(A, e.f, 'comments') }));
  const supers = rows.filter((r) => r.profile === 'super_admin');
  const cols: Col<ARow>[] = [
    { title: 'Name', render: (r) => <b>{r.key}{r.key === me && <span className="badge info" style={{ marginLeft: 6 }}>you</span>}</b> },
    { title: 'Type', render: () => 'Local' },
    { title: 'Administrator Profile', render: (r) => r.profile },
    { title: 'Trusted Hosts', render: (r) => <span className="mono">{r.trusted.join(', ') || 'any'}</span> },
    { title: 'Two-factor Authentication', render: () => <span className="muted">Disabled</span> },
    { title: 'Comments', render: (r) => <span className="muted">{r.comments}</span> },
  ];
  return (
    <div className="page">
      <div className="page-title">Administrators</div>
      <ObjectList
        groups={[{ title: 'System Administrator', rows }]}
        cols={cols}
        onCreate={() => navigate('sys-admins', 'new')}
        onEdit={(r) => navigate('sys-admins', r.key)}
        canDelete={(r) => (r.key === me ? 'You cannot delete the account you are logged in with.' : r.profile === 'super_admin' && supers.length === 1 ? 'At least one super_admin administrator must remain.' : null)}
        onDelete={(r) => deleteEntry('system admin', r.key)}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Trusted hosts restrict <b>where</b> an administrator may log in from, which is one of the most important hardening steps on a real FortiGate. The login screen in FWallSim lets you choose the lab host you connect from, so you can test it.
      </p>
    </div>
  );
}

function AdminEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const A = def('system admin');
  const e = name ? find(config, 'system admin', name) : undefined;
  const hosts0 = name ? trustedHosts(config, name) : [];
  const [f, setF] = useState({
    name,
    pw: '',
    pw2: '',
    profile: e ? str(A, e.f, 'accprofile') : 'prof_admin',
    restrict: hosts0.length > 0,
    hosts: [0, 1, 2].map((i) => {
      const n = parseIpMask(hosts0[i] ?? '');
      return n ? `${intToIp(n.ip)}/${n.prefix}` : '';
    }),
    comments: e ? str(A, e.f, 'comments') : '',
  });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const profiles = entries(config, 'system accprofile').map((p) => p.key);

  const save = () => {
    const ne = nameError(config, 'system admin', name || null, f.name.trim());
    if (ne) return setErr(ne);
    if (!e && !f.pw) return setErr('Enter a password for the new administrator.');
    if (f.pw !== f.pw2) return setErr('Passwords do not match.');
    const fields: Fields = { accprofile: f.profile, vdom: ['root'], password: f.pw || (e ? str(A, e.f, 'password') : '') };
    if (f.restrict) {
      const hs = f.hosts.filter((h) => h.trim());
      if (!hs.length) return setErr('Enter at least one trusted host, or turn the restriction off.');
      for (let i = 0; i < hs.length; i++) {
        const n = parseIpMask(hs[i]);
        if (!n) return setErr(`Trusted host "${hs[i]}" is not a valid IP/netmask.`);
        fields[`trusthost${i + 1}`] = fmtIpMask(n);
      }
    }
    if (f.comments) fields.comments = f.comments;
    if (saveEntry('system admin', name || null, f.name.trim(), fields, 'Administrator')) navigate('sys-admins');
  };

  return (
    <EditPage title={name ? `Edit Administrator: ${name}` : 'New Administrator'} onOk={save} onCancel={() => navigate('sys-admins')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Username">{name ? <b>{name}</b> : <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} />}</Field>
      <Field label="Type">Local User</Field>
      <Field label={name ? 'New Password' : 'Password'} help={name ? 'Leave empty to keep the current password.' : undefined}>
        <input className="inp" type="password" value={f.pw} onChange={(e) => up('pw', e.target.value)} />
      </Field>
      <Field label="Confirm Password">
        <input className="inp" type="password" value={f.pw2} onChange={(e) => up('pw2', e.target.value)} />
      </Field>
      <Field label="Comments">
        <textarea className="inp" value={f.comments} onChange={(e) => up('comments', e.target.value)} />
      </Field>
      <Field label="Administrator profile">
        <select className="sel" value={f.profile} onChange={(e) => up('profile', e.target.value)}>
          {profiles.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </Field>
      <Section title={<Toggle on={f.restrict} onChange={(v) => up('restrict', v)} label="Restrict login to trusted hosts" />}>
        {f.restrict &&
          f.hosts.map((h, i) => (
            <Field key={i} label={`Trusted Host ${i + 1}`} help={i === 0 ? 'e.g. 192.168.1.110/32 for PC1 only, or 192.168.1.0/24 for the whole LAN.' : undefined}>
              <input className="inp" value={h} onChange={(e) => up('hosts', f.hosts.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
      </Section>
    </EditPage>
  );
}

// ---------- Admin Profiles ----------

export function AdminProfilesPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <ProfileEdit name={editKey === 'new' ? '' : editKey} /> : <ProfileList />;
}

function ProfileList() {
  const config = useStore((s) => s.config);
  const rows = entries(config, 'system accprofile').map((e) => ({ key: e.key, perms: profilePerms(config, e.key) }));
  const short = (p: Perm) => (p === 'read-write' ? <span className="badge ok">RW</span> : p === 'read' ? <span className="badge info">R</span> : <span className="badge grey">-</span>);
  const cols: Col<(typeof rows)[number]>[] = [{ title: 'Name', render: (r) => <b>{r.key}</b> }, ...PERM_GROUPS.map((g) => ({ title: g.label, render: (r: (typeof rows)[number]) => short(r.perms[g.id]) }))];
  return (
    <div className="page">
      <div className="page-title">Admin Profiles</div>
      <ObjectList groups={[{ title: '', rows }]} cols={cols} refPathOf={() => 'system accprofile'} onCreate={() => navigate('sys-profiles', 'new')} onEdit={(r) => navigate('sys-profiles', r.key)} canDelete={(r) => (r.key === 'super_admin' || r.key === 'prof_admin' ? 'Built-in profiles cannot be deleted.' : null)} onDelete={(r) => deleteEntry('system accprofile', r.key)} />
      <p className="muted" style={{ marginTop: 10 }}>
        A profile decides what an administrator may see (Read) and change (Read/Write) in each area. Areas set to None disappear from that administrator's menu.
      </p>
    </div>
  );
}

function ProfileEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const P = def('system accprofile');
  const e = name ? find(config, 'system accprofile', name) : undefined;
  const [pn, setPn] = useState(name);
  const [perms, setPerms] = useState<Record<string, Perm>>(() => (name ? profilePerms(config, name) : Object.fromEntries(PERM_GROUPS.map((g) => [g.id, 'read' as Perm]))));
  const [comments, setComments] = useState(e ? str(P, e.f, 'comments') : '');
  const [err, setErr] = useState('');
  const builtin = name === 'super_admin';
  const save = () => {
    const ne = nameError(config, 'system accprofile', name || null, pn.trim());
    if (ne) return setErr(ne);
    const fields: Fields = { ...perms };
    if (comments) fields.comments = comments;
    if (saveEntry('system accprofile', name || null, pn.trim(), fields, 'Admin profile')) navigate('sys-profiles');
  };
  return (
    <EditPage title={name ? `Edit Admin Profile: ${name}` : 'New Admin Profile'} onOk={builtin ? () => navigate('sys-profiles') : save} onCancel={() => navigate('sys-profiles')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">{name ? <b>{name}</b> : <input className="inp" value={pn} onChange={(e) => setPn(e.target.value)} placeholder="e.g. helpdesk-readonly" />}</Field>
      <Field label="Comments">
        <textarea className="inp" value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
      {builtin && <p className="muted">super_admin always has full access and cannot be changed.</p>}
      <Section title="Access Permissions">
        <div style={{ paddingLeft: 220, marginBottom: 8, display: 'flex', gap: 6 }}>
          {(['none', 'read', 'read-write'] as Perm[]).map((p) => (
            <button key={p} className="btn sm" disabled={builtin} onClick={() => setPerms(Object.fromEntries(PERM_GROUPS.map((g) => [g.id, p])))}>
              Set all: {p === 'none' ? 'None' : p === 'read' ? 'Read' : 'Read/Write'}
            </button>
          ))}
        </div>
        {PERM_GROUPS.map((g) => (
          <Field key={g.id} label={g.label} help={g.covers}>
            <Seg
              value={perms[g.id]}
              onChange={(v) => !builtin && setPerms({ ...perms, [g.id]: v })}
              options={[
                { v: 'none', label: 'None' },
                { v: 'read', label: 'Read' },
                { v: 'read-write', label: 'Read/Write' },
              ]}
            />
          </Field>
        ))}
      </Section>
    </EditPage>
  );
}
