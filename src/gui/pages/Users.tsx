import { useState } from 'react';
import { CheckCircle, Plus, Trash2, XCircle } from 'lucide-react';
import { navigate, toast, updateConfig, useStore } from '../../store';
import type { Config, Fields } from '../../engine/types';
import { def, entries, find, list, objectOf, str, sub } from '../../engine/config';
import { ldapCheck, radiusCheck, type CheckResult } from '../../engine/auth';
import { DIRECTORY } from '../../engine/topology';
import { ObjectList, type Col } from '../ObjectList';
import { Chip, EditPage, Field, Modal, Section, Seg, Toggle } from '../ui';
import { authServerOptions, EntryPicker, userOptions } from '../picker';
import { deleteEntry, nameError, saveEntry } from '../save';

// ---------- shared ----------

function TestResult({ r }: { r: CheckResult | null }) {
  if (!r) return null;
  return (
    <div className="walk-lines" style={{ marginTop: 8 }}>
      <div className={r.ok ? 'ok-text' : 'err-text'} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
        {r.ok ? <CheckCircle size={14} /> : <XCircle size={14} />} {r.msg}
      </div>
      {r.steps.map((s, i) => (
        <div key={i} className="mono">
          {s}
        </div>
      ))}
    </div>
  );
}

function CredModal({ title, onTest, onClose }: { title: string; onTest: (u: string, p: string) => CheckResult; onClose: () => void }) {
  const [u, setU] = useState('jsmith');
  const [p, setP] = useState('');
  const [r, setR] = useState<CheckResult | null>(null);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={() => setR(onTest(u, p))}>
            Test
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <Field label="Username">
        <input className="inp" value={u} onChange={(e) => setU(e.target.value)} />
      </Field>
      <Field label="Password">
        <input className="inp" type="password" value={p} onChange={(e) => setP(e.target.value)} />
      </Field>
      <TestResult r={r} />
    </Modal>
  );
}

/** Apply edited fields to a scratch copy of the config so "Test" uses what is on screen, before saving. */
function withEntry(c: Config, path: string, key: string, fields: Fields): Config {
  const copy = structuredClone(c);
  const t = copy[path] && copy[path].kind === 'table' ? copy[path] : (copy[path] = { kind: 'table', entries: [] });
  if (t.kind !== 'table') return copy;
  const e = t.entries.find((x) => x.key === key);
  if (e) e.f = fields;
  else t.entries.push({ key, f: fields });
  return copy;
}

// ---------- User Definition ----------

interface URow {
  key: string;
  type: string;
  server: string;
  status: boolean;
  groups: string[];
}

export function UserDefinitionPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <UserEdit name={editKey === 'new' ? '' : editKey} /> : <UserList />;
}

function UserList() {
  const config = useStore((s) => s.config);
  const U = def('user local');
  const GR = def('user group');
  const rows: URow[] = entries(config, 'user local').map((e) => ({
    key: e.key,
    type: str(U, e.f, 'type'),
    server: str(U, e.f, 'ldap-server') || str(U, e.f, 'radius-server'),
    status: str(U, e.f, 'status') === 'enable',
    groups: entries(config, 'user group')
      .filter((g) => list(GR, g.f, 'member').includes(e.key))
      .map((g) => g.key),
  }));
  const TYPE: Record<string, string> = { password: 'Local', ldap: 'LDAP', radius: 'RADIUS' };
  const cols: Col<URow>[] = [
    { title: 'User Name', render: (r) => <Chip kind="user" name={r.key} /> },
    { title: 'Type', render: (r) => TYPE[r.type] + (r.server ? ` (${r.server})` : '') },
    { title: 'Two-factor Authentication', render: () => <span className="muted">Disabled</span> },
    { title: 'Groups', render: (r) => r.groups.join(', ') },
    { title: 'Status', render: (r) => (r.status ? <span className="badge ok">Enabled</span> : <span className="badge grey">Disabled</span>) },
  ];
  return (
    <div className="page">
      <div className="page-title">User Definition</div>
      <ObjectList groups={[{ title: '', rows }]} cols={cols} refPathOf={() => 'user local'} onCreate={() => navigate('usr-def', 'new')} onEdit={(r) => navigate('usr-def', r.key)} onDelete={(r) => deleteEntry('user local', r.key)} rowClass={(r) => (r.status ? '' : 'disabled')} />
      <p className="muted" style={{ marginTop: 10 }}>
        A <b>Local</b> user's password is stored on the FortiGate. An <b>LDAP</b> or <b>RADIUS</b> user has only the name here; the password is checked against the remote server. To let a whole directory group in without creating users one by one, put the LDAP server in a user group instead.
      </p>
    </div>
  );
}

function UserEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const U = def('user local');
  const e = name ? find(config, 'user local', name) : undefined;
  const s = (n: string) => (e ? str(U, e.f, n) : '');
  const [f, setF] = useState({ name, type: e ? s('type') : 'password', pw: '', ldap: s('ldap-server'), radius: s('radius-server'), status: e ? s('status') === 'enable' : true, email: s('email-to') });
  const [err, setErr] = useState('');
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const ldaps = entries(config, 'user ldap').map((x) => x.key);
  const radii = entries(config, 'user radius').map((x) => x.key);

  const save = () => {
    const ne = nameError(config, 'user local', name || null, f.name.trim());
    if (ne) return setErr(ne);
    const fields: Fields = {};
    if (!f.status) fields.status = 'disable';
    if (f.type !== 'password') fields.type = f.type;
    if (f.type === 'password') {
      const pw = f.pw || (e ? s('passwd') : '');
      if (!pw) return setErr('Enter a password.');
      fields.passwd = pw;
    } else if (f.type === 'ldap') {
      if (!f.ldap) return setErr('Select an LDAP server (create one under LDAP Servers first).');
      fields['ldap-server'] = f.ldap;
    } else {
      if (!f.radius) return setErr('Select a RADIUS server (create one under RADIUS Servers first).');
      fields['radius-server'] = f.radius;
    }
    if (f.email) fields['email-to'] = f.email;
    saveEntry('user local', name || null, f.name.trim(), fields, 'User');
    navigate('usr-def');
  };

  return (
    <EditPage title={name ? `Edit User: ${name}` : 'New User'} onOk={save} onCancel={() => navigate('usr-def')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="User Type">
        <Seg
          value={f.type}
          onChange={(v) => up('type', v)}
          options={[
            { v: 'password', label: 'Local User' },
            { v: 'ldap', label: 'Remote LDAP User' },
            { v: 'radius', label: 'Remote RADIUS User' },
          ]}
        />
      </Field>
      <Field label="Username">
        <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} placeholder={f.type === 'password' ? 'e.g. guest1' : 'must match the directory account, e.g. jsmith'} />
      </Field>
      {f.type === 'password' && (
        <Field label="Password" help={e ? 'Leave empty to keep the current password.' : undefined}>
          <input className="inp" type="password" value={f.pw} onChange={(e) => up('pw', e.target.value)} />
        </Field>
      )}
      {f.type === 'ldap' && (
        <Field label="LDAP Server">
          <select className="sel" value={f.ldap} onChange={(e) => up('ldap', e.target.value)}>
            <option value="">Select…</option>
            {ldaps.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
      )}
      {f.type === 'radius' && (
        <Field label="RADIUS Server">
          <select className="sel" value={f.radius} onChange={(e) => up('radius', e.target.value)}>
            <option value="">Select…</option>
            {radii.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
      )}
      <Section title="Contact Info">
        <Field label="Email Address">
          <input className="inp" value={f.email} onChange={(e) => up('email', e.target.value)} />
        </Field>
        <Field label="Two-factor Authentication">
          <Toggle on={false} disabled label={<span className="muted">not simulated</span>} />
        </Field>
      </Section>
      <Field label="User Account Status">
        <Seg
          value={f.status ? 'on' : 'off'}
          onChange={(v) => up('status', v === 'on')}
          options={[
            { v: 'on', label: 'Enabled' },
            { v: 'off', label: 'Disabled' },
          ]}
        />
      </Field>
    </EditPage>
  );
}

// ---------- User Groups ----------

interface GRow {
  key: string;
  members: string[];
  remote: string[];
}

export function UserGroupsPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <GroupEdit name={editKey === 'new' ? '' : editKey} /> : <GroupList />;
}

function GroupList() {
  const config = useStore((s) => s.config);
  const GR = def('user group');
  const M = GR.fields.find((f) => f.name === 'match')!.sub!;
  const rows: GRow[] = entries(config, 'user group').map((e) => ({
    key: e.key,
    members: list(GR, e.f, 'member'),
    remote: (sub(e.f, 'match')?.entries ?? []).map((m) => `${str(M, m.f, 'server-name')}: ${str(M, m.f, 'group-name')}`),
  }));
  const cols: Col<GRow>[] = [
    { title: 'Group Name', render: (r) => <Chip kind="usergrp" name={r.key} /> },
    { title: 'Group Type', render: () => 'Firewall' },
    { title: 'Members', render: (r) => <div className="chips">{r.members.map((m) => <Chip key={m} kind={find(config, 'user local', m) ? 'user' : 'authsrv'} name={m} />)}</div> },
    { title: 'Remote Groups', render: (r) => <div className="chips">{r.remote.map((m) => <span key={m} className="mono" style={{ fontSize: 12 }}>{m}</span>)}</div> },
  ];
  return (
    <div className="page">
      <div className="page-title">User Groups</div>
      <ObjectList groups={[{ title: '', rows }]} cols={cols} refPathOf={() => 'user group'} onCreate={() => navigate('usr-grp', 'new')} onEdit={(r) => navigate('usr-grp', r.key)} onDelete={(r) => deleteEntry('user group', r.key)} />
      <p className="muted" style={{ marginTop: 10 }}>
        Firewall policies match <b>groups</b>, not individual logins. Members can be local users, remote users, or a whole LDAP/RADIUS server. A "Remote Group" limits a server member to users in that directory group.
      </p>
    </div>
  );
}

function GroupEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const GR = def('user group');
  const M = GR.fields.find((f) => f.name === 'match')!.sub!;
  const e = name ? find(config, 'user group', name) : undefined;
  const [gn, setGn] = useState(name);
  const [members, setMembers] = useState<string[]>(e ? list(GR, e.f, 'member') : []);
  const [remote, setRemote] = useState<{ server: string; group: string }[]>(e ? (sub(e.f, 'match')?.entries ?? []).map((m) => ({ server: str(M, m.f, 'server-name'), group: str(M, m.f, 'group-name') })) : []);
  const [err, setErr] = useState('');
  const servers = members.filter((m) => find(config, 'user ldap', m) || find(config, 'user radius', m));

  const save = () => {
    const ne = nameError(config, 'user group', name || null, gn.trim());
    if (ne) return setErr(ne);
    const fields: Fields = {};
    if (members.length) fields.member = members;
    const rows = remote.filter((r) => r.server && r.group);
    if (rows.some((r) => !members.includes(r.server))) return setErr('A remote group must belong to a server that is also a member of this group.');
    if (rows.length) fields.match = { kind: 'table', entries: rows.map((r, i) => ({ key: String(i + 1), f: { 'server-name': r.server, 'group-name': r.group } })) };
    saveEntry('user group', name || null, gn.trim(), fields, 'User group');
    navigate('usr-grp');
  };

  return (
    <EditPage title={name ? `Edit User Group: ${name}` : 'New User Group'} onOk={save} onCancel={() => navigate('usr-grp')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={gn} onChange={(e) => setGn(e.target.value)} />
      </Field>
      <Field label="Type">Firewall</Field>
      <Field label="Members" help="Pick users, or an LDAP/RADIUS server to accept its users.">
        <EntryPicker value={members} options={[...userOptions(config).filter((o) => o.kind === 'user'), ...authServerOptions(config)]} onChange={setMembers} />
      </Field>
      <Section title="Remote Groups">
        {remote.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', paddingLeft: 220 }}>
            <select className="sel" style={{ width: 160 }} value={r.server} onChange={(e) => setRemote(remote.map((x, j) => (j === i ? { ...x, server: e.target.value } : x)))}>
              <option value="">Server…</option>
              {servers.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select className="sel" style={{ width: 340 }} value={r.group} onChange={(e) => setRemote(remote.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))}>
              <option value="">Group…</option>
              {DIRECTORY.groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <button className="btn sm" onClick={() => setRemote(remote.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <div style={{ paddingLeft: 220 }}>
          <button className="btn sm" disabled={!servers.length} onClick={() => setRemote([...remote, { server: servers[0], group: '' }])}>
            <Plus size={12} /> Add
          </button>
          {!servers.length && <span className="muted" style={{ marginLeft: 8 }}>Add an LDAP or RADIUS server as a member first.</span>}
        </div>
      </Section>
    </EditPage>
  );
}

// ---------- LDAP Servers ----------

export function LdapServersPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <LdapEdit name={editKey === 'new' ? '' : editKey} /> : <ServerList path="user ldap" page="usr-ldap" title="LDAP Servers" />;
}

export function RadiusServersPage() {
  const editKey = useStore((s) => s.ui.editKey);
  return editKey ? <RadiusEdit name={editKey === 'new' ? '' : editKey} /> : <ServerList path="user radius" page="usr-radius" title="RADIUS Servers" />;
}

function ServerList({ path, page, title }: { path: string; page: string; title: string }) {
  const config = useStore((s) => s.config);
  const D = def(path);
  const rows = entries(config, path).map((e) => ({ key: e.key, server: str(D, e.f, 'server'), port: path === 'user ldap' ? str(D, e.f, 'port') : str(D, e.f, 'radius-port') === '0' ? '1812' : str(D, e.f, 'radius-port'), check: path === 'user ldap' ? ldapCheck(config, e.key) : radiusCheck(config, e.key) }));
  const cols: Col<(typeof rows)[number]>[] = [
    { title: 'Name', render: (r) => <Chip kind="authsrv" name={r.key} /> },
    { title: 'Server', render: (r) => <span className="mono">{r.server}</span> },
    { title: 'Port', render: (r) => r.port },
    { title: 'Status', render: (r) => (r.check.ok ? <span className="badge ok">Successful</span> : <span className="badge err" title={r.check.msg}>Failed: {r.check.msg}</span>) },
  ];
  return (
    <div className="page">
      <div className="page-title">{title}</div>
      <ObjectList groups={[{ title: '', rows }]} cols={cols} refPathOf={() => path} onCreate={() => navigate(page, 'new')} onEdit={(r) => navigate(page, r.key)} onDelete={(r) => deleteEntry(path, r.key)} />
      <div className="side-card" style={{ width: 'auto', maxWidth: 720, marginTop: 12 }}>
        <h4>Lab directory: AD-Server ({DIRECTORY.domain})</h4>
        <div className="kv">
          <span>Server IP</span>
          <span className="mono">{DIRECTORY.ip} (DMZ)</span>
          <span>LDAP</span>
          <span className="mono">TCP 389, LDAPS 636</span>
          <span>Base DN</span>
          <span className="mono">{DIRECTORY.base}</span>
          <span>Bind DN / password</span>
          <span className="mono">
            {DIRECTORY.bindDn} / {DIRECTORY.bindPw}
          </span>
          <span>RADIUS</span>
          <span className="mono">UDP 1812, secret {DIRECTORY.radiusSecret}</span>
          <span>Users</span>
          <span className="mono">{DIRECTORY.users.map((u) => `${u.user} / ${u.pw}`).join(' · ')}</span>
        </div>
      </div>
    </div>
  );
}

function LdapEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const L = def('user ldap');
  const e = name ? find(config, 'user ldap', name) : undefined;
  const s = (n: string) => (e ? str(L, e.f, n) : (L.fields.find((x) => x.name === n)?.default as string) ?? '');
  const [f, setF] = useState({ name, server: s('server'), port: s('port'), cnid: s('cnid'), dn: s('dn'), type: e ? s('type') : 'regular', username: s('username'), password: '', secure: s('secure') });
  const [err, setErr] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [cred, setCred] = useState(false);
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const fields = (): Fields => {
    const o: Fields = { server: f.server.trim() };
    if (f.cnid && f.cnid !== 'cn') o.cnid = f.cnid;
    if (f.dn) o.dn = f.dn.trim();
    if (f.type !== 'simple') o.type = f.type;
    if (f.type === 'regular') {
      o.username = f.username.trim();
      o.password = f.password || (e ? s('password') : '');
    }
    if (f.secure !== 'disable') o.secure = f.secure;
    if (f.port !== '389') o.port = f.port;
    return o;
  };
  const key = f.name.trim() || '__test__';
  const test = () => setResult(ldapCheck(withEntry(config, 'user ldap', key, fields()), key));

  const save = () => {
    const ne = nameError(config, 'user ldap', name || null, f.name.trim());
    if (ne) return setErr(ne);
    if (!f.server.trim()) return setErr('Enter the server IP or name.');
    saveEntry('user ldap', name || null, f.name.trim(), fields(), 'LDAP server');
    navigate('usr-ldap');
  };

  return (
    <EditPage title={name ? `Edit LDAP Server: ${name}` : 'New LDAP Server'} onOk={save} onCancel={() => navigate('usr-ldap')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={f.name} onChange={(e) => up('name', e.target.value)} placeholder="LAB-AD" />
      </Field>
      <Field label="Server IP/Name">
        <input className="inp" value={f.server} onChange={(e) => up('server', e.target.value)} placeholder={DIRECTORY.ip} />
      </Field>
      <Field label="Server Port">
        <input className="inp sm" value={f.port} onChange={(e) => up('port', e.target.value)} />
      </Field>
      <Field label="Common Name Identifier" help="Attribute that holds the login name: cn, or sAMAccountName on Active Directory.">
        <input className="inp" value={f.cnid} onChange={(e) => up('cnid', e.target.value)} />
      </Field>
      <Field label="Distinguished Name" help="Where to search for users, e.g. dc=lab,dc=local">
        <input className="inp" value={f.dn} onChange={(e) => up('dn', e.target.value)} />
      </Field>
      <Field label="Bind Type">
        <Seg
          value={f.type}
          onChange={(v) => up('type', v)}
          options={[
            { v: 'simple', label: 'Simple' },
            { v: 'anonymous', label: 'Anonymous' },
            { v: 'regular', label: 'Regular' },
          ]}
        />
      </Field>
      {f.type === 'regular' && (
        <>
          <Field label="Username" help="Full DN of the service account the FortiGate binds with.">
            <input className="inp" value={f.username} onChange={(e) => up('username', e.target.value)} />
          </Field>
          <Field label="Password" help={e ? 'Leave empty to keep the current password.' : undefined}>
            <input className="inp" type="password" value={f.password} onChange={(e) => up('password', e.target.value)} />
          </Field>
        </>
      )}
      <Field label="Secure Connection">
        <Toggle on={f.secure !== 'disable'} onChange={(v) => setF({ ...f, secure: v ? 'ldaps' : 'disable', port: v ? '636' : '389' })} />
        {f.secure !== 'disable' && (
          <div style={{ marginTop: 6 }}>
            <Seg
              value={f.secure}
              onChange={(v) => up('secure', v)}
              options={[
                { v: 'ldaps', label: 'LDAPS' },
                { v: 'starttls', label: 'STARTTLS' },
              ]}
            />
          </div>
        )}
      </Field>
      <Field label="Connection status">
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm" onClick={test}>
            Test Connectivity
          </button>
          <button className="btn sm" onClick={() => setCred(true)}>
            Test User Credentials
          </button>
        </div>
        <TestResult r={result} />
      </Field>
      {cred && <CredModal title="Test User Credentials" onClose={() => setCred(false)} onTest={(u, p) => ldapCheck(withEntry(config, 'user ldap', key, fields()), key, u, p)} />}
    </EditPage>
  );
}

function RadiusEdit({ name }: { name: string }) {
  const config = useStore((s) => s.config);
  const R = def('user radius');
  const e = name ? find(config, 'user radius', name) : undefined;
  const [f, setF] = useState({ name, server: e ? str(R, e.f, 'server') : '', secret: '', auth: e ? str(R, e.f, 'auth-type') : 'auto' });
  const [err, setErr] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [cred, setCred] = useState(false);
  const fields = (): Fields => ({ server: f.server.trim(), secret: f.secret || (e ? str(R, e.f, 'secret') : ''), ...(f.auth !== 'auto' ? { 'auth-type': f.auth } : {}) });
  const key = f.name.trim() || '__test__';
  const save = () => {
    const ne = nameError(config, 'user radius', name || null, f.name.trim());
    if (ne) return setErr(ne);
    if (!f.server.trim()) return setErr('Enter the server IP or name.');
    saveEntry('user radius', name || null, f.name.trim(), fields(), 'RADIUS server');
    navigate('usr-radius');
  };
  return (
    <EditPage title={name ? `Edit RADIUS Server: ${name}` : 'New RADIUS Server'} onOk={save} onCancel={() => navigate('usr-radius')}>
      {err && <p className="err-text">{err}</p>}
      <Field label="Name">
        <input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="LAB-RADIUS" />
      </Field>
      <Field label="Authentication method">
        <select className="sel" value={f.auth} onChange={(e) => setF({ ...f, auth: e.target.value })}>
          <option value="auto">Default</option>
          <option value="ms_chap_v2">MS-CHAP-v2</option>
          <option value="chap">CHAP</option>
          <option value="pap">PAP</option>
        </select>
      </Field>
      <Field label="IP/Name">
        <input className="inp" value={f.server} onChange={(e) => setF({ ...f, server: e.target.value })} placeholder={DIRECTORY.ip} />
      </Field>
      <Field label="Secret" help={e ? 'Leave empty to keep the current secret.' : 'Must match the secret configured on the RADIUS server.'}>
        <input className="inp" type="password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
      </Field>
      <Field label="Connection status">
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm" onClick={() => setResult(radiusCheck(withEntry(config, 'user radius', key, fields()), key))}>
            Test Connectivity
          </button>
          <button className="btn sm" onClick={() => setCred(true)}>
            Test User Credentials
          </button>
        </div>
        <TestResult r={result} />
      </Field>
      {cred && <CredModal title="Test User Credentials" onClose={() => setCred(false)} onTest={(u, p) => radiusCheck(withEntry(config, 'user radius', key, fields()), key, u, p)} />}
    </EditPage>
  );
}

// ---------- Authentication Settings ----------

export function AuthSettingsPage() {
  const config = useStore((s) => s.config);
  const S = def('user setting');
  const o = config['user setting']?.kind === 'object' ? config['user setting'].f : {};
  const [timeout, setTimeoutV] = useState(str(S, o, 'auth-timeout'));
  const [types, setTypes] = useState(list(S, o, 'auth-type'));
  const [port, setPort] = useState(str(S, o, 'auth-port-https'));
  const apply = () => {
    const t = Number(timeout);
    if (!(t >= 1 && t <= 1440)) return toast('Timeout must be 1–1440 minutes.', 'err');
    updateConfig((c) => {
      const f = objectOf(c, 'user setting').f;
      f['auth-timeout'] = String(t);
      f['auth-type'] = types;
      f['auth-port-https'] = port;
    }, 'Edit user.setting');
    toast('Authentication settings applied');
  };
  return (
    <div className="page">
      <div className="page-title">Authentication Settings</div>
      <div className="form-card">
        <Field label="Authentication timeout (minutes)" help="Logged-in users are removed after this time (idle timeout).">
          <input className="inp sm" value={timeout} onChange={(e) => setTimeoutV(e.target.value)} />
        </Field>
        <Field label="Protocol support" help="Which protocols can trigger the login prompt when a user hits an identity-based policy unauthenticated.">
          <div className="checks">
            {['http', 'https', 'ftp', 'telnet'].map((t) => (
              <label key={t}>
                <input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} />
                {t.toUpperCase()}
              </label>
            ))}
          </div>
        </Field>
        <Field label="HTTPS authentication port">
          <input className="inp sm" value={port} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <div className="form-footer">
          <button className="btn primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
