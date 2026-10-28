import { useSyncExternalStore } from 'react';
import type { Config } from './engine/types';
import { factoryConfig, migrateConfig, SCENARIOS } from './engine/defaults';
import { sslConnect, syncTunnelInterfaces, type SslResult } from './engine/vpn';
import { emptyRuntime, type EventLog, type Runtime } from './engine/runtime';
import { runLocalOut, runTraffic, type TrafficRequest } from './engine/packet';
import { find, def, str, gobj } from './engine/config';
import { defaultLab, setLab, type LabState } from './engine/lab';
import { authenticate, type LoginResult } from './engine/auth';
import { buildNet } from './engine/net';
import { adminLogin, changedPaths, hashAdminPasswords, hashAdminPw, needsAdminSetup, writeDenied } from './engine/admin';
import { FIRMWARES, NMS_IP, snmpWalk, syslogTarget, upgradeBlocked, type SnmpResult, type SyslogTarget } from './engine/mgmt';
import { eventRaw, trafficRaw } from './engine/logfmt';
import { LABS } from './labs/labs';
import { MODEL } from './engine/serialize';

export type DockState = 'min' | 'normal' | 'max';
export type DockTab = 'topology' | 'traffic' | 'walk' | 'debug' | 'users' | 'vpn' | 'wan' | 'mgmt';

export interface UiState {
  page: string;
  editKey: string | null;
  dock: DockState;
  dockTab: DockTab;
  sidebarCollapsed: boolean;
  cliOpen: boolean;
  selectedResult: number | null;
  logFilter: string;
  labSrc: string;
}

export interface AuthState {
  loggedIn: boolean;
  mustChange: boolean;
  user: string;
  since: number;
  from?: string; // source IP of the admin session
  fromHost?: string;
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
}

export interface Training {
  active: string | null;
  completed: Record<string, number>; // lab id -> completion time
  hints: Record<string, number>; // lab id -> hints revealed
}

export interface State {
  training: Training;
  config: Config;
  runtime: Runtime;
  ui: UiState;
  auth: AuthState;
  toasts: Toast[];
  booting: boolean;
  /** The first-visit Welcome screen has been seen in this browser. */
  welcomed: boolean;
  /** On a phone: the visitor chose to continue despite the "best on a computer" notice. */
  phoneOk: boolean;
  /** Bumped when the config changes outside the GUI forms (CLI, restore, scenario, lab), so open pages reload. */
  rev: number;
  /** Top-level config paths changed by that external change. */
  revPaths: string[];
}

const LS_CONFIG = 'fwallsim.config.v1';
const LS_RUNTIME = 'fwallsim.runtime.v1';
const LS_UI = 'fwallsim.ui.v1';
const SS_AUTH = 'fwallsim.auth.v1';
const LS_TRAINING = 'fwallsim.training.v1';
const LS_WELCOMED = 'fwallsim.welcomed.v1';
const LS_PHONEOK = 'fwallsim.phoneok.v1';

function load<T>(store: Storage, key: string, fallback: () => T): T {
  try {
    const s = store.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback();
  } catch {
    return fallback();
  }
}

const defaultUi: UiState = { page: 'dash-status', editKey: null, dock: 'normal', dockTab: 'traffic', sidebarCollapsed: false, cliOpen: false, selectedResult: null, logFilter: '', labSrc: 'pc1' };

let state: State = {
  training: { active: null, completed: {}, hints: {}, ...load<Partial<Training>>(localStorage, LS_TRAINING, () => ({})) },
  config: migrateConfig(load(localStorage, LS_CONFIG, factoryConfig)),
  runtime: { ...emptyRuntime(), ...load<Partial<Runtime>>(localStorage, LS_RUNTIME, () => ({})) },
  ui: { ...defaultUi, ...load<Partial<UiState>>(localStorage, LS_UI, () => ({})), editKey: null, cliOpen: false },
  auth: load(sessionStorage, SS_AUTH, () => ({ loggedIn: false, mustChange: false, user: '', since: 0 })),
  toasts: [],
  booting: false,
  welcomed: load(localStorage, LS_WELCOMED, () => false),
  phoneOk: load(localStorage, LS_PHONEOK, () => false),
  rev: 0,
  revPaths: [],
};

state.runtime.lab = { ...defaultLab(), ...state.runtime.lab };
setLab(state.runtime.lab);

const listeners = new Set<() => void>();

function persist(prev: State, next: State) {
  try {
    if (prev.config !== next.config) localStorage.setItem(LS_CONFIG, JSON.stringify(next.config));
    if (prev.runtime !== next.runtime) {
      const { history, ...rest } = next.runtime;
      localStorage.setItem(LS_RUNTIME, JSON.stringify({ ...rest, history: history.slice(0, 10) }));
    }
    if (prev.ui !== next.ui) {
      const { page, dock, dockTab, sidebarCollapsed } = next.ui;
      localStorage.setItem(LS_UI, JSON.stringify({ page, dock, dockTab, sidebarCollapsed }));
    }
    if (prev.auth !== next.auth) sessionStorage.setItem(SS_AUTH, JSON.stringify(next.auth));
    if (prev.training !== next.training) localStorage.setItem(LS_TRAINING, JSON.stringify(next.training));
    if (prev.welcomed !== next.welcomed) localStorage.setItem(LS_WELCOMED, JSON.stringify(next.welcomed));
    if (prev.phoneOk !== next.phoneOk) localStorage.setItem(LS_PHONEOK, JSON.stringify(next.phoneOk));
  } catch {
    /* storage full or blocked: the app keeps working in memory */
  }
}

let syslogCache: { config: Config; lab: LabState; t: SyslogTarget } | null = null;

/** The lab syslog server receives every new log line while remote syslog is configured and reachable. */
function withSyslog(prev: State, next: State): State {
  if (next.runtime === prev.runtime || next.runtime.seq.log === prev.runtime.seq.log) return next;
  if (gobj(next.config, 'log syslogd setting', 'status') !== 'enable') return next;
  if (!syslogCache || syslogCache.config !== next.config || syslogCache.lab !== next.runtime.lab) {
    setLab(next.runtime.lab);
    syslogCache = { config: next.config, lab: next.runtime.lab, t: syslogTarget(next.config, buildNet(next.config)) };
  }
  if (!syslogCache.t.ok) return next;
  const since = prev.runtime.seq.log;
  const dev = { name: gobj(next.config, 'system global', 'hostname'), id: `${MODEL}TK26000001` };
  const lines = [...next.runtime.trafficLogs.filter((l) => l.id > since).map((l) => `<189>${trafficRaw(l, dev)}`), ...next.runtime.eventLogs.filter((e) => e.id > since).map((e) => `<190>${eventRaw(e, dev)}`)];
  if (!lines.length) return next;
  return { ...next, runtime: { ...next.runtime, syslog: [...lines, ...(next.runtime.syslog ?? [])].slice(0, 300) } };
}

/** Marks a config change made outside the GUI forms, with the top-level paths it touched. */
function external(next: Config): Pick<State, 'rev' | 'revPaths'> {
  const keys = new Set([...Object.keys(state.config), ...Object.keys(next)]);
  const revPaths = [...keys].filter((k) => JSON.stringify(state.config[k]) !== JSON.stringify(next[k]));
  return { rev: state.rev + 1, revPaths };
}

function set(patch: Partial<State>) {
  const prev = state;
  state = withSyslog(prev, { ...state, ...patch });
  if (state.runtime.lab !== prev.runtime.lab) setLab(state.runtime.lab);
  persist(prev, state);
  listeners.forEach((l) => l());
}

export const getState = () => state;

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
    () => sel(state),
  );
}

// ---------- events / toasts ----------

let toastId = 0;
/**
 * Set when a save is refused by the admin profile. Edit pages do "save; toast('saved'); navigate(list)"
 * synchronously, so for a moment after a denial we drop the success toast and keep the form open.
 */
let deniedAt = 0;
const justDenied = () => Date.now() - deniedAt < 100;

export function toast(msg: string, kind: Toast['kind'] = 'ok') {
  if (kind === 'ok' && justDenied()) return;
  const t = { id: ++toastId, msg, kind };
  set({ toasts: [...state.toasts, t] });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), kind === 'err' ? 6000 : 3500);
}

export function logEvent(msg: string, opts: Partial<Pick<EventLog, 'level' | 'action' | 'logdesc' | 'ui'>> = {}) {
  const rt = state.runtime;
  const e: EventLog = {
    id: rt.seq.log + 1,
    time: Date.now(),
    level: opts.level ?? 'information',
    user: state.auth.user || 'admin',
    ui: opts.ui ?? `GUI(${state.auth.from ?? '192.168.1.110'})`,
    action: opts.action ?? 'Edit',
    logdesc: opts.logdesc ?? 'Object attribute configured',
    msg,
  };
  set({ runtime: { ...rt, seq: { ...rt.seq, log: rt.seq.log + 1 }, eventLogs: [e, ...rt.eventLogs].slice(0, 1000) } });
}

// ---------- config ----------

export const CLI_UI = 'jsconsole(192.168.1.110)';

export function updateConfig(fn: (c: Config) => void, msg?: string, ui?: string) {
  const c = structuredClone(state.config);
  fn(c);
  syncTunnelInterfaces(c);
  hashAdminPasswords(c);
  if (state.auth.loggedIn) {
    const denied = writeDenied(state.config, state.auth.user, changedPaths(state.config, c));
    if (denied) {
      toast(denied, 'err');
      deniedAt = Date.now();
      return false;
    }
  }
  set({ config: c });
  if (msg) logEvent(msg, { ui });
  return true;
}

/** Used by the CLI to commit its working copy. */
export function commitConfig(c: Config, msg: string): string | null {
  const copy = structuredClone(c);
  syncTunnelInterfaces(copy);
  hashAdminPasswords(copy);
  if (state.auth.loggedIn) {
    const denied = writeDenied(state.config, state.auth.user, changedPaths(state.config, copy));
    if (denied) return denied;
  }
  set({ ...external(copy), config: copy });
  if (msg) logEvent(msg, { ui: CLI_UI });
  return null;
}

export function replaceConfig(c: Config, msg: string) {
  migrateConfig(c);
  syncTunnelInterfaces(c);
  set({ ...external(c), config: c });
  logEvent(msg, { logdesc: 'Configuration changed', action: 'restore' });
}

/** Scenarios and labs replace the network config but keep the user's own admin accounts. */
function keepAdmins(next: Config): Config {
  for (const p of ['system admin', 'system accprofile']) if (state.config[p]) next[p] = structuredClone(state.config[p]);
  return next;
}

export function loadScenario(id: string) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) return;
  // A scenario is not a reboot: keep uptime and the event log.
  const next = keepAdmins(migrateConfig(s.build()));
  set({ ...external(next), config: next, runtime: { ...emptyRuntime(), bootTime: state.runtime.bootTime, eventLogs: state.runtime.eventLogs, seq: state.runtime.seq } });
  logEvent(`Loaded lab scenario "${s.name}"`, { logdesc: 'Configuration changed', action: 'restore' });
  toast(`Scenario loaded: ${s.name}`);
}

// ---------- ui ----------

export function setUi(patch: Partial<UiState>) {
  set({ ui: { ...state.ui, ...patch } });
}

export function navigate(page: string, editKey: string | null = null) {
  if (justDenied() && state.ui.editKey && page === state.ui.page) return; // stay on the refused form
  setUi({ page, editKey });
}

// ---------- traffic ----------

export function sendTraffic(req: TrafficRequest) {
  const rt = runTraffic(state.config, state.runtime, req);
  set({ runtime: rt, ui: { ...state.ui, selectedResult: rt.history[0].id } });
  return rt.history[0];
}

export function sendLocalOut(target: string, kind: 'ping' | 'traceroute') {
  const r = runLocalOut(state.config, state.runtime, target, kind);
  set({ runtime: r.rt });
  return r;
}

/** "snmpwalk -v2c -c <community> 10.10.10.1" run on the NMS-Server. */
export function snmpWalkFromNms(community: string): SnmpResult {
  const net = buildNet(state.config);
  const target = net.ifs['dmz']?.ipStr;
  if (!target) return { ok: false, reason: 'The dmz interface has no IP address.', lines: [] };
  const rt = runTraffic(state.config, state.runtime, { srcHost: 'nms', dst: target, proto: 'udp', dport: 161, label: `NMS-Server snmpwalk ${target}` });
  set({ runtime: rt });
  const r = rt.history[0];
  if (!r.ok) return { ok: false, reason: `Timeout: ${r.summary}`, lines: [] };
  return snmpWalk(state.config, net, community, NMS_IP);
}

export function clearSyslog() {
  set({ runtime: { ...state.runtime, syslog: [] } });
}

export function firmwareUpgrade(version: string): string | null {
  const cur = state.runtime.firmware?.version ?? '7.4.4';
  const blocked = upgradeBlocked(cur, version);
  if (blocked) return blocked;
  const fw = FIRMWARES.find((f) => f.version === version)!;
  set({ runtime: { ...state.runtime, firmware: { version: fw.version, build: fw.build } } });
  logEvent(`Firmware upgraded from v${cur} to v${fw.version} build${fw.build}`, { level: 'warning', action: 'upgrade', logdesc: 'Firmware upgraded' });
  reboot();
  return null;
}

// ---------- training (guided labs) ----------

export function startLab(id: string) {
  const lab = LABS.find((l) => l.id === id);
  if (!lab) return;
  const c = keepAdmins(migrateConfig(lab.build()));
  syncTunnelInterfaces(c);
  set({
    ...external(c),
    config: c,
    runtime: { ...emptyRuntime(), bootTime: state.runtime.bootTime, eventLogs: state.runtime.eventLogs, seq: state.runtime.seq, lab: { ...defaultLab(), ...(lab.lab ?? {}) } },
    training: { ...state.training, active: id, hints: { ...state.training.hints, [id]: 0 } },
    ui: { ...state.ui, page: lab.startPage ?? 'dash-status', editKey: null, selectedResult: null },
  });
  logEvent(`Started lab "${lab.title}"`, { action: 'lab', logdesc: 'Training lab started' });
}

export function exitLab() {
  set({ training: { ...state.training, active: null } });
}

export function markLabComplete(id: string) {
  if (state.training.completed[id]) return;
  set({ training: { ...state.training, completed: { ...state.training.completed, [id]: Date.now() } } });
  const lab = LABS.find((l) => l.id === id);
  logEvent(`Completed lab "${lab?.title ?? id}"`, { action: 'lab', logdesc: 'Training lab completed' });
  toast(`Lab complete: ${lab?.title ?? id}`);
}

export function revealHint(id: string) {
  set({ training: { ...state.training, hints: { ...state.training.hints, [id]: (state.training.hints[id] ?? 0) + 1 } } });
}

export function resetTraining() {
  set({ training: { active: null, completed: {}, hints: {} } });
}

export function clearHistory() {
  set({ runtime: { ...state.runtime, history: [] }, ui: { ...state.ui, selectedResult: null } });
}

export function tick() {
  const now = Date.now();
  const alive = state.runtime.sessions.filter((s) => now - s.created < s.ttl * 1000);
  if (alive.length !== state.runtime.sessions.length) set({ runtime: { ...state.runtime, sessions: alive } });
  const auth = state.runtime.lab.auth;
  const expired = Object.values(auth).filter((a) => a.expires < now);
  if (expired.length) {
    const next = { ...auth };
    for (const a of expired) delete next[a.ip];
    set({ runtime: { ...state.runtime, lab: { ...state.runtime.lab, auth: next } } });
    for (const a of expired) logEvent(`User ${a.user} (${a.ip}) authentication timed out`, { action: 'auth-logout', logdesc: 'Authentication logon timeout', ui: 'firewall' });
  }
}

export function updateLab(fn: (l: LabState) => LabState) {
  set({ runtime: { ...state.runtime, lab: fn(state.runtime.lab) } });
}

/** A lab host submits the FortiGate authentication portal form. */
export function firewallLogin(hostId: string, user: string, pw: string): LoginResult {
  const net = buildNet(state.config);
  const h = net.hosts.find((x) => x.host.id === hostId);
  const r = authenticate(state.config, user, pw);
  if (!h?.ip || !h.ok) return { ...r, ok: false, msg: `${h?.host.name ?? hostId} has no working network connection` };
  if (!r.ok) {
    logEvent(`User ${user} failed in authentication`, { level: 'notice', action: 'authentication', logdesc: 'Authentication failed', ui: `https(${h.ip})` });
    return r;
  }
  const mins = Number(gobj(state.config, 'user setting', 'auth-timeout')) || 5;
  const now = Date.now();
  updateLab((l) => ({ ...l, auth: { ...l.auth, [h.ip!]: { ip: h.ip!, host: h.host.name, user: r.user, groups: r.groups, method: r.method!, server: r.server, time: now, expires: now + mins * 60_000 } } }));
  logEvent(`User ${user} succeeded in authentication`, { action: 'authentication', logdesc: 'Authentication success', ui: `https(${h.ip})` });
  return r;
}

export function vpnSetDown(name: string, down: boolean) {
  updateLab((l) => ({ ...l, vpnDown: { ...l.vpnDown, [name]: down } }));
  logEvent(`IPsec tunnel ${name} ${down ? 'brought down' : 'brought up'} by administrator`, { action: down ? 'tunnel-down' : 'negotiate', logdesc: down ? 'IPsec connection status change' : 'IPsec phase 1 negotiate' });
}

export function sslVpnConnect(hostId: string, gw: string, port: number, user: string, pw: string): SslResult {
  const net = buildNet(state.config);
  const used = Object.values(state.runtime.lab.sslClients).filter((x) => x.host !== hostId).map((x) => x.ip);
  const r = sslConnect(state.config, net, gw, port, user, pw, used);
  const h = net.hosts.find((x) => x.host.id === hostId);
  if (!r.ok || !r.ip) {
    logEvent(`SSL user ${user} failed to log in from ${h?.ip}: ${r.msg}`, { level: 'warning', action: 'ssl-login-fail', logdesc: 'SSL VPN login fail', ui: `sslvpn(${h?.ip})` });
    return r;
  }
  const now = Date.now();
  updateLab((l) => ({
    ...l,
    sslClients: { ...l.sslClients, [hostId]: { host: hostId, user, groups: r.groups ?? [], ip: r.ip!, portal: r.portal!, time: now } },
    auth: { ...l.auth, [r.ip!]: { ip: r.ip!, host: h?.host.name ?? hostId, user, groups: r.groups ?? [], method: 'local', server: 'SSL-VPN', time: now, expires: now + 8 * 3600_000 } },
  }));
  logEvent(`SSL tunnel established: user ${user} from ${h?.ip}, tunnel IP ${r.ip}`, { action: 'tunnel-up', logdesc: 'SSL VPN tunnel up', ui: `sslvpn(${h?.ip})` });
  return r;
}

export function sslVpnDisconnect(hostId: string) {
  const cl = state.runtime.lab.sslClients[hostId];
  if (!cl) return;
  updateLab((l) => {
    const sslClients = { ...l.sslClients };
    delete sslClients[hostId];
    const auth = { ...l.auth };
    delete auth[cl.ip];
    return { ...l, sslClients, auth };
  });
  logEvent(`SSL tunnel shutdown: user ${cl.user}, tunnel IP ${cl.ip}`, { action: 'tunnel-down', logdesc: 'SSL VPN tunnel down' });
}

export function firewallLogout(ip: string) {
  const a = state.runtime.lab.auth[ip];
  if (!a) return;
  updateLab((l) => {
    const auth = { ...l.auth };
    delete auth[ip];
    return { ...l, auth };
  });
  logEvent(`User ${a.user} (${ip}) was de-authenticated`, { action: 'auth-logout', logdesc: 'Authentication logout' });
}

export function endSessions(ids: number[] | 'all') {
  const sessions = ids === 'all' ? [] : state.runtime.sessions.filter((s) => !ids.includes(s.id));
  set({ runtime: { ...state.runtime, sessions } });
}

export function clearPolicyCounters(id?: string) {
  const ps = { ...state.runtime.policyStats };
  if (id) delete ps[id];
  set({ runtime: { ...state.runtime, policyStats: id ? ps : {} } });
}

export function clearLogs(kind: 'traffic' | 'event') {
  set({ runtime: { ...state.runtime, ...(kind === 'traffic' ? { trafficLogs: [] } : { eventLogs: [] }) } });
}

// ---------- auth ----------

export function adminPassword(c: Config = state.config): string {
  const a = find(c, 'system admin', 'admin');
  return a ? str(def('system admin'), a.f, 'password') : '';
}

/** Hosts an admin can browse from on the login screen. */
export const ADMIN_SOURCES = [
  { id: 'pc1', label: 'PC1-Admin (LAN, internal)' },
  { id: 'pc2', label: 'PC2-Sales (LAN, internal)' },
  { id: 'user', label: 'Internet-User (via wan1)' },
];

export function login(user: string, pass: string, fromHost = 'pc1'): string | null {
  const c = state.config;
  const net = buildNet(c);
  const h = net.hosts.find((x) => x.host.id === fromHost);
  if (!h?.ip || !h.ok) return `${h?.host.name ?? fromHost} has no working network connection.`;
  // Reach the GUI the way a browser would: HTTPS to the FortiGate, checked by Administrative Access.
  const target = h.host.segment === 'internet' ? net.ifs['wan1']?.ipStr : net.ifs[h.logical ?? '']?.ipStr;
  const port = Number(gobj(c, 'system global', 'admin-sport')) || 443;
  if (!target) return 'The FortiGate has no IP address on that side of the network.';
  const probe = runTraffic(c, state.runtime, { srcHost: fromHost, dst: target, proto: 'tcp', dport: port }).history[0];
  if (!probe.ok) return `Unable to connect to https://${target}:${port} from ${h.host.name}. ${probe.summary}`;
  const now = Date.now();
  const lock = state.runtime.adminLock?.[h.ip];
  if (lock && lock.until > now) return `Too many failed login attempts from ${h.ip}. Try again in ${Math.ceil((lock.until - now) / 1000)} seconds.`;
  const r = adminLogin(c, user, pass, h.ip);
  const setLock = (v: { fails: number; until: number }) => set({ runtime: { ...state.runtime, adminLock: { ...state.runtime.adminLock, [h.ip!]: v } } });
  if (!r.ok) {
    const threshold = Number(gobj(c, 'system global', 'admin-lockout-threshold')) || 3;
    const duration = Number(gobj(c, 'system global', 'admin-lockout-duration')) || 60;
    // until === 0 means "counting failures, not locked"; an expired lock starts a fresh count.
    const fails = (lock && lock.until === 0 ? lock.fails : 0) + 1;
    logEvent(`Administrator ${user || '(empty)'} login failed from https(${h.ip}) because of ${r.reason}`, { level: 'alert', action: 'login', logdesc: 'Admin login failed', ui: `https(${h.ip})` });
    if (fails >= threshold) {
      setLock({ fails: 0, until: now + duration * 1000 });
      logEvent(`Login disabled from IP ${h.ip} for ${duration} seconds because of ${threshold} bad attempts`, { level: 'alert', action: 'login', logdesc: 'Admin login disabled', ui: `https(${h.ip})` });
      return `Authentication failure. Login from ${h.ip} is now locked for ${duration} seconds (${threshold} failed attempts).`;
    }
    setLock({ fails, until: 0 });
    return 'Authentication failure';
  }
  setLock({ fails: 0, until: 0 });
  set({ auth: { loggedIn: true, mustChange: r.mustChange, user, since: now, from: h.ip, fromHost } });
  logEvent(`Administrator ${user} logged in successfully from https(${h.ip})`, { action: 'login', logdesc: 'Admin login successful', ui: `https(${h.ip})` });
  return null;
}

export function logout(reason = 'logged out') {
  logEvent(`Administrator ${state.auth.user} ${reason} from https(192.168.1.110)`, { action: 'logout', logdesc: 'Admin logout successful' });
  set({ auth: { loggedIn: false, mustChange: false, user: '', since: 0 } });
}

/** Any admin may change their own password, whatever their profile allows. */
export function changePassword(pw: string) {
  const c = structuredClone(state.config);
  const user = state.auth.user || 'admin';
  const a = find(c, 'system admin', user);
  if (a) a.f.password = hashAdminPw(pw);
  set({ config: c, auth: { ...state.auth, mustChange: false } });
  logEvent(`Edit system.admin ${user} password`);
}

// ---------- first visit ----------

export function dismissWelcome() {
  set({ welcomed: true });
}

export function dismissPhoneNotice() {
  set({ phoneOk: true });
}

/** The unit is factory-fresh: show "Create your admin password" instead of the login form. */
export const needsSetup = (c: Config = state.config) => needsAdminSetup(c);

/** First visit (or after a factory reset): set the admin password and log in from PC1. */
export function setupAdmin(pw: string): string | null {
  const c = structuredClone(state.config);
  const a = find(c, 'system admin', 'admin');
  if (!a) return 'There is no admin account on this unit.';
  a.f.password = hashAdminPw(pw);
  set({ config: c, welcomed: true });
  logEvent('Edit system.admin admin password', { logdesc: 'Admin password set at first login' });
  return login('admin', pw, 'pc1');
}

/** When a lockout of this lab PC ends (0 if it is not locked). */
export function lockedUntil(fromHost: string): number {
  const ip = buildNet(state.config).hosts.find((x) => x.host.id === fromHost)?.ip;
  const until = ip ? state.runtime.adminLock?.[ip]?.until ?? 0 : 0;
  return until > Date.now() ? until : 0;
}

/** Re-use the first-login screen for a voluntary password change. */
export function changePasswordPrompt() {
  set({ auth: { ...state.auth, mustChange: true } });
}

export function reboot() {
  logEvent('User admin rebooted the device from GUI.', { level: 'warning', action: 'reboot', logdesc: 'Device rebooted' });
  set({ booting: true, auth: { loggedIn: false, mustChange: false, user: '', since: 0 } });
  setTimeout(() => set({ booting: false, runtime: { ...state.runtime, bootTime: Date.now(), sessions: [] } }), 2500);
}

export function factoryReset() {
  const fresh = factoryConfig();
  set({ ...external(fresh), config: fresh, runtime: emptyRuntime(), auth: { loggedIn: false, mustChange: false, user: '', since: 0 }, ui: { ...defaultUi } });
}

export const hostname = () => gobj(state.config, 'system global', 'hostname');
