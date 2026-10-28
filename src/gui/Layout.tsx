import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Bell, ChevronDown, ChevronRight, CheckCircle, Download, HelpCircle, Info, KeyRound, LogOut, Menu as MenuIcon, Power, RotateCcw, Terminal, Upload, User, XCircle } from 'lucide-react';
import { MENU, LEAVES } from './menu';
import { changePasswordPrompt, logout, navigate, reboot, setUi, useStore, getState, toast, replaceConfig } from '../store';
import { gobj } from '../engine/config';
import { adminProfile, MENU_PERM, profilePerms } from '../engine/admin';
import { APP_VERSION, serializeConfig, parseConfigText } from '../engine/serialize';
import { Dropdown, Modal, PageBoundary, TABLET, useMedia } from './ui';
import { LabDock } from '../lab/LabDock';
import { Cli } from './Cli';
import { StatusDashboard } from './pages/Dashboard';
import { NetworkDashboard } from './pages/DashNetwork';
import { SessionsPage } from './pages/Sessions';
import { InterfacesPage } from './pages/Interfaces';
import { DnsPage } from './pages/Dns';
import { StaticRoutesPage } from './pages/StaticRoutes';
import { PoliciesPage } from './pages/Policies';
import { AddressesPage } from './pages/Addresses';
import { ServicesPage } from './pages/Services';
import { SchedulesPage } from './pages/Schedules';
import { VipsPage } from './pages/Vips';
import { IpPoolsPage } from './pages/IpPools';
import { SettingsPage } from './pages/Settings';
import { ForwardLogPage, LocalLogPage, EventLogPage, LogSettingsPage } from './pages/Logs';
import { ComingSoon } from './pages/ComingSoon';
import { UserDefinitionPage, UserGroupsPage, LdapServersPage, RadiusServersPage, AuthSettingsPage } from './pages/Users';
import { UserMonitorPage } from './pages/UserMonitor';
import { IpsecTunnelsPage, IpsecWizardPage } from './pages/Ipsec';
import { SslPortalsPage, SslSettingsPage } from './pages/SslVpn';
import { BgpPage, OspfPage, PolicyRoutesPage } from './pages/Routing';
import { SdWanPage } from './pages/SdWan';
import { AdministratorsPage, AdminProfilesPage } from './pages/Admins';
import { FirmwarePage, LocalInPage, SnmpPage } from './pages/Mgmt';
import { TrainingPage } from './pages/Training';
import { LabGuide } from './LabGuide';
import { GraduationCap } from 'lucide-react';

const PAGES: Record<string, ComponentType> = {
  'dash-status': StatusDashboard,
  'dash-network': NetworkDashboard,
  'dash-sessions': SessionsPage,
  'net-interfaces': InterfacesPage,
  'net-dns': DnsPage,
  'net-static': StaticRoutesPage,
  'pol-policy': PoliciesPage,
  'pol-address': AddressesPage,
  'pol-service': ServicesPage,
  'pol-schedule': SchedulesPage,
  'pol-vip': VipsPage,
  'pol-ippool': IpPoolsPage,
  'sys-settings': SettingsPage,
  'log-forward': ForwardLogPage,
  'log-local': LocalLogPage,
  'log-events': EventLogPage,
  'log-settings': LogSettingsPage,
  'dash-users': UserMonitorPage,
  'usr-def': UserDefinitionPage,
  'usr-grp': UserGroupsPage,
  'usr-ldap': LdapServersPage,
  'usr-radius': RadiusServersPage,
  'usr-settings': AuthSettingsPage,
  'vpn-ipsec': IpsecTunnelsPage,
  'vpn-wizard': IpsecWizardPage,
  'vpn-sslportal': SslPortalsPage,
  'vpn-sslsettings': SslSettingsPage,
  'net-pbr': PolicyRoutesPage,
  'net-bgp': BgpPage,
  'net-ospf': OspfPage,
  'net-sdwan': SdWanPage,
  'sys-admins': AdministratorsPage,
  'sys-profiles': AdminProfilesPage,
  'pol-localin': LocalInPage,
  'sys-snmp': SnmpPage,
  'sys-firmware': FirmwarePage,
  training: TrainingPage,
};

/** Config paths each editing page saves to (pages not listed reload on any outside change). */
const PAGE_PATHS: Record<string, string[]> = {
  'net-interfaces': ['system interface', 'system zone', 'system dhcp server'],
  'net-dns': ['system dns'],
  'net-sdwan': ['system sdwan'],
  'net-static': ['router static'],
  'net-pbr': ['router policy'],
  'net-ospf': ['router ospf'],
  'net-bgp': ['router bgp'],
  'pol-policy': ['firewall policy'],
  'pol-address': ['firewall address', 'firewall addrgrp'],
  'pol-service': ['firewall service custom', 'firewall service group'],
  'pol-schedule': ['firewall schedule recurring', 'firewall schedule onetime'],
  'pol-vip': ['firewall vip'],
  'pol-localin': ['firewall local-in-policy'],
  'pol-ippool': ['firewall ippool'],
  'vpn-ipsec': ['vpn ipsec phase1-interface', 'vpn ipsec phase2-interface'],
  'vpn-wizard': ['vpn ipsec phase1-interface', 'vpn ipsec phase2-interface'],
  'vpn-sslportal': ['vpn ssl web portal'],
  'vpn-sslsettings': ['vpn ssl settings'],
  'usr-def': ['user local'],
  'usr-grp': ['user group'],
  'usr-ldap': ['user ldap'],
  'usr-radius': ['user radius'],
  'usr-settings': ['user setting'],
  'sys-admins': ['system admin'],
  'sys-profiles': ['system accprofile'],
  'sys-settings': ['system global', 'system settings'],
  'sys-snmp': ['system snmp sysinfo', 'system snmp community'],
  'log-settings': ['log setting', 'log syslogd setting'],
};

export function Layout() {
  const ui = useStore((s) => s.ui);
  const host = useStore((s) => gobj(s.config, 'system global', 'hostname'));
  const toasts = useStore((s) => s.toasts);
  const user = useStore((s) => s.auth.user);
  const config = useStore((s) => s.config);
  const rev = useStore((s) => s.rev);
  const revPaths = useStore((s) => s.revPaths);
  // Reload the open page only when an outside change (CLI, restore, lab) touched what this page edits,
  // so stale values cannot be re-applied, while unrelated CLI work keeps the user's unsaved edits.
  const contentRef = useRef<HTMLDivElement>(null);
  // a newly opened page (or form) starts at the top, not at the previous page's scroll position
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [ui.page, ui.editKey]);
  const [pageRev, setPageRev] = useState(0);
  const [seenRev, setSeenRev] = useState(rev);
  if (rev !== seenRev) {
    setSeenRev(rev);
    const owned = PAGE_PATHS[ui.page];
    if (!owned || revPaths.some((p) => owned.includes(p))) setPageRev(pageRev + 1);
  }
  const profile = adminProfile(config, user);
  const readOnly = Object.values(profilePerms(config, profile)).every((p) => p !== 'read-write');
  const [modal, setModal] = useState<'restore' | 'reboot' | 'about' | null>(null);
  const Page = PAGES[ui.page] ?? ComingSoon;
  // On tablets and phones the menu slides in over the page (opened with ☰) instead of taking width.
  const narrow = useMedia(TABLET);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [ui.page, ui.editKey, narrow]);
  const collapsed = !narrow && ui.sidebarCollapsed;
  const toggleNav = () => (narrow ? setNavOpen(!navOpen) : setUi({ sidebarCollapsed: !collapsed }));

  const backup = () => {
    const txt = serializeConfig(getState().config);
    const blob = new Blob([txt], { type: 'text/plain' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `${host}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.conf`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Configuration backed up');
  };

  return (
    <div className="app">
      <div className="hdr">
        <div className={`brand ${collapsed ? 'collapsed' : ''}`}>
          {!collapsed && (
            <>
              <div className="logo">F</div>
              <span className="brand-name">FWallSim</span>
              <span className="hostname" title={`Hostname: ${host}`}>
                {host}
              </span>
            </>
          )}
          <button className="hdr-btn brand-toggle" onClick={toggleNav} title={narrow ? (navOpen ? 'Close menu' : 'Open menu') : collapsed ? 'Expand menu' : 'Collapse menu'}>
            <MenuIcon size={18} />
          </button>
        </div>
        <span className="spacer" />
        <button className="hdr-btn" title="Labs & Challenges" onClick={() => navigate('training')}>
          <GraduationCap size={17} /> <span className="hdr-label" style={{ fontSize: 12 }}>Labs</span>
        </button>
        <button className="hdr-btn" title="CLI Console" onClick={() => setUi({ cliOpen: !ui.cliOpen })}>
          <Terminal size={17} />
        </button>
        <button className="hdr-btn" title="Help" onClick={() => setModal('about')}>
          <HelpCircle size={17} />
        </button>
        <button className="hdr-btn" title="Notifications" onClick={() => toast('No new notifications', 'info')}>
          <Bell size={17} />
        </button>
        <Dropdown
          className="hdr-btn"
          right
          label={
            <>
              <User size={16} /> {user}
              {profile !== 'super_admin' && (
                <span className="badge grey" style={{ marginLeft: 4 }}>
                  {readOnly ? 'read-only' : profile}
                </span>
              )}
            </>
          }
          items={[
            { label: 'System' },
            { label: 'Reboot', icon: <RotateCcw size={14} />, onClick: () => setModal('reboot') },
            { label: 'Configuration' },
            { label: 'Backup', icon: <Download size={14} />, onClick: backup },
            { label: 'Restore', icon: <Upload size={14} />, onClick: () => setModal('restore') },
            { label: 'Admin' },
            { label: 'Change Password', icon: <KeyRound size={14} />, onClick: changePasswordPrompt },
            { label: 'Logout', icon: <LogOut size={14} />, onClick: () => logout() },
          ]}
        />
      </div>
      <div className="body">
        <nav className={`side ${collapsed ? 'collapsed' : ''} ${narrow ? 'side-drawer' : ''} ${narrow && navOpen ? 'open' : ''}`} aria-hidden={narrow && !navOpen}>
          <Sidebar collapsed={collapsed} />
        </nav>
        {narrow && navOpen && <div className="side-backdrop" onClick={() => setNavOpen(false)} />}
        <div className="main">
          <div className="content-row">
            <div className="content" ref={contentRef}>
              <PageBoundary key={`${ui.page}:${pageRev}`}>
                <Page />
              </PageBoundary>
            </div>
            <LabGuide />
          </div>
          <LabDock />
        </div>
      </div>
      {ui.cliOpen && <Cli />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'err' ? <XCircle size={16} color="var(--err)" /> : t.kind === 'info' ? <Info size={16} color="var(--info)" /> : <CheckCircle size={16} color="var(--ok)" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {modal === 'restore' && <RestoreModal onClose={() => setModal(null)} />}
      {modal === 'reboot' && (
        <Modal
          title="Confirm Reboot"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn primary" onClick={() => reboot()}>
                <Power size={14} /> OK
              </button>
              <button className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
            </>
          }
        >
          The device will reboot. All sessions are cleared, and you will need to log in again. Your configuration is kept.
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title="About FWallSim" onClose={() => setModal(null)}>
          <p>
            <b>FWallSim v{APP_VERSION}</b> is a local FortiGate-style firewall training simulator. Everything runs in your browser. No device, licence or trial is needed.
          </p>
          <p>
            Use the <b>Lab</b> panel at the bottom to send traffic from the simulated PCs, servers and internet hosts. Then read the <b>Packet Walk</b> and <b>Debug Flow</b> to see exactly how the firewall decided.
          </p>
          <p className="muted">Includes interfaces, DHCP, routing (static, policy, BGP, OSPF), SD-WAN, policies, objects, NAT/VIP, users and LDAP, IPsec and SSL-VPN, admin hardening, logs, a full CLI and 19 guided labs. Planned for v1.1: HA, VDOMs, traffic shaping and security-profile inspection.</p>
        </Modal>
      )}
    </div>
  );
}

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const page = useStore((s) => s.ui.page);
  const config = useStore((s) => s.config);
  const user = useStore((s) => s.auth.user);
  const perms = profilePerms(config, adminProfile(config, user));
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [LEAVES[page]?.group ?? 'Dashboard']: true }));
  const [q, setQ] = useState('');
  const groupOf = MENU.find((g) => g.items.some((i) => i.id === page))?.id;
  return (
    <>
      {!collapsed && (
        <div className="side-search">
          <input placeholder="Search menu" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {MENU.filter((g) => !MENU_PERM[g.id] || perms[MENU_PERM[g.id]!] !== 'none').map((g) => {
        const items = g.items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));
        if (q && !items.length) return null;
        const isOpen = !!q || open[g.label] || (collapsed ? false : g.id === groupOf && open[g.label] !== false);
        const Icon = g.icon;
        return (
          <div className="nav-group" key={g.id}>
            <div className="nav-item" title={g.label} onClick={() => (collapsed ? navigate(g.items[0].id) : setOpen({ ...open, [g.label]: !isOpen }))}>
              <Icon size={17} />
              {!collapsed && (
                <>
                  {g.label}
                  <span className="chev">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                </>
              )}
            </div>
            {isOpen && !collapsed && (
              <div className="nav-sub">
                {items.map((i) => (
                  <div key={i.id} className={`nav-item ${page === i.id ? 'active' : ''}`} onClick={() => navigate(i.id)}>
                    {i.label}
                    {i.phase && <span className="phase" title="Not simulated yet: planned for a later version">later</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!collapsed && <div className="side-foot">FWallSim v{APP_VERSION}</div>}
    </>
  );
}

function RestoreModal({ onClose }: { onClose: () => void }) {
  const [err, setErr] = useState('');
  const onFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then((txt) => {
      try {
        const c = parseConfigText(txt);
        replaceConfig(c, `System config restored from file ${f.name}`);
        onClose();
        reboot();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  };
  return (
    <Modal title="Restore System Configuration" onClose={onClose}>
      <p>Upload a configuration file (.conf) that you saved with Backup. The device reboots after a restore.</p>
      <input type="file" accept=".conf,.txt" onChange={(e) => onFile(e.target.files?.[0])} />
      {err && <p className="err-text">{err}</p>}
    </Modal>
  );
}
