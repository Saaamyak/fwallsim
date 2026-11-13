import { useState } from 'react';
import { APP_VERSION, FW_VERSION } from '../engine/serialize';
import { Modal } from './ui';

const REPO = 'https://github.com/Saaamyak/fwallsim';

/** What FWallSim is, where your data lives, and the trademark note. Shown from the header Help button and the login screens. */
export function AboutContent() {
  return (
    <div className="about">
      <p className="muted">
        FWallSim v{APP_VERSION} · simulated firmware {FW_VERSION}
      </p>
      <p>
        <b>FWallSim</b> is an independent learning tool: a FortiGate-style firewall simulator. Everything runs in your browser. No device, licence or trial is needed.
      </p>
      <p>
        Use the <b>Lab</b> panel at the bottom to send traffic from the simulated PCs, servers and internet hosts. Then read the <b>Packet Walk</b> and <b>Debug Flow</b> to see exactly how the firewall decided.
      </p>
      <p className="muted">Includes interfaces, DHCP, routing (static, policy, BGP, OSPF), SD-WAN, policies, objects, NAT/VIP, users and LDAP, IPsec and SSL-VPN, admin hardening, logs, a full CLI and 20 guided labs. The course comes with 20 class handouts (PDF), one per lab, plus a course plan: open them from <b>Labs</b> in the header. Planned for v1.2: HA, VDOMs, traffic shaping and security-profile inspection.</p>
      <h4>Your data</h4>
      <ul>
        <li>Your firewall configuration, passwords, logs and training progress are stored only in this browser (local storage) and never sent anywhere.</li>
        <li>The admin password is stored as a one-way hash.</li>
        <li>All traffic is simulated. No real packets leave your computer.</li>
        <li>On the hosted site, Vercel Web Analytics counts anonymous page views (no cookies, nothing you type or configure).</li>
        <li>
          To remove everything: <b>System &gt; Settings &gt; Factory reset</b> (keeps your training progress), or clear this site's data in your browser.
        </li>
      </ul>
      <p>
        Source code and setup:{' '}
        <a href={REPO} target="_blank" rel="noopener noreferrer">
          github.com/Saaamyak/fwallsim
        </a>
      </p>
      <p className="muted about-legal">
        FWallSim is not affiliated with or endorsed by Fortinet. FortiGate, FortiOS and other Fortinet names are trademarks of Fortinet, Inc., used here only to describe what is simulated.
      </p>
    </div>
  );
}

/** A small text link that opens the About content in a modal (for the login screens). */
export function AboutLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link about-link" onClick={() => setOpen(true)}>
        About &amp; privacy
      </button>
      {open && (
        <Modal title="About FWallSim" onClose={() => setOpen(false)}>
          <AboutContent />
        </Modal>
      )}
    </>
  );
}
