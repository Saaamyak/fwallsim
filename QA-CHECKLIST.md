# FWallSim v1.0.0 – Manual QA checklist

Automated: `npm test` runs the typecheck, the engine regression suite (57 checks, including CLI robustness and value ranges), lab solvability plus backup/restore round trip (19 labs) and the browser tests (41 Playwright tests in Chromium, including phone and tablet sizes, including a sweep that opens, edits and saves every page on a fresh and on a busy unit). Use this list for a hands-on pass. Start each section from a factory reset (System > Settings > Factory reset) unless noted.

## 1. Login and shell
- [ ] First visit (private window): Welcome screen with the "not affiliated with Fortinet" notice → Get started → Create your admin password → empty and mismatch errors shown → Save and log in → Dashboard opens. Reload after logout: no Welcome again.
- [ ] Header shows `FWallSim | FWS60F`. ☰ collapses and expands the menu. Sidebar footer shows `FWallSim v1.0.0`.
- [ ] Logout, then a wrong password → "Authentication failure". The new password works.
- [ ] Three wrong passwords → "locked for N more seconds" counts down; switching "Connecting from" to PC2-Sales lets you log in.
- [ ] Forgot the password: login page → "Forgot password or locked out? Reset to factory defaults" → Create your admin password appears; training progress is kept.
- [ ] Browser dev tools → Application → Local Storage: `fwallsim.config.v1` holds `SH2…`, never the password you typed. A Backup file shows `set password ENC SH2…`.
- [ ] Reload keeps you logged in on the same page. A private window asks for login.
- [ ] System > Settings > Theme Dark Matter → whole UI dark, survives reload.

## 2. Network
- [ ] Interfaces: edit internal → set 10.10.10.5/24 → "same subnet" error. Set 192.168.10.1/24 + DHCP range → PCs get 192.168.10.x (Dashboard > Network > DHCP).
- [ ] Static Routes: invalid gateway rejected. A valid route shows Active.
- [ ] DNS: Specify 8.8.8.8 → Apply → reload → still 8.8.8.8.

## 3. Policy & Objects
- [ ] Addresses: create, invalid IP rejected, duplicate name rejected, group with member, delete while used → refused, rename updates the group.
- [ ] Firewall Policy: build internal → wan1 with the pickers. PC1 ping 8.8.8.8 passes. Packet Walk shows Source NAT. Debug Flow shows `Allowed by Policy-1: SNAT`.
- [ ] Right-click Disable → traffic denied. Enable again. Drag to reorder (By Sequence). Policy Lookup finds policy 1.
- [ ] Virtual IP + wan1 → dmz policy: "Internet user visits your website" passes. Attacker SSH is denied.
- [ ] Local-In Policy: deny SNMP on dmz → NMS snmpwalk shows "Blocked by local-in policy".

## 4. CLI (>_)
- [ ] `sh` + Tab → `show `. `?` lists commands. `conf sys glo` / `set hostname X` / `end` → header changes.
- [ ] `set srcintf nosuch` → "entry not found in datasource". A missing attribute → "MUST be set".
- [ ] `diag debug flow filter addr 8.8.8.8`, `trace start 5`, `diag debug enable` → Lab ping prints trace lines.
- [ ] `diag sniffer packet any "host 8.8.8.8" 4` → packets appear. Ctrl+C prints the summary.
- [ ] With SSL-VPN Settings open, `config vpn ssl settings` / `set port 10443` / `end` → the page shows 10443 (no stale values). A CLI change to something else (e.g. a policy) keeps unsaved edits on the open page.
- [ ] Out-of-range values are refused: `set admintimeout 900`, `set tcp-portrange 70000`, `edit 999999999999` in firewall policy.

## 5. Users and VPN
- [ ] LDAP server: wrong bind password → "Invalid credentials". Correct → "Successful".
- [ ] Identity policy with a Sales group: before login, PC1 web → portal (DNS refused). Lab > Users login jsmith → browsing works. adoe → refused.
- [ ] IPsec Wizard (PSK Branch-PSK-2026) → tunnel Up. PC1 ↔ Branch-PC works in both directions.
- [ ] SSL-VPN: listen wan1:10443, rule → portal, ssl.root policy → Lab > VPN Connect → Laptop RDP to PC1 works.

## 6. Routing and SD-WAN
- [ ] BGP AS 65010, neighbor 203.0.113.1 remote-as 64500 → Established. A wrong AS → the reason is shown.
- [ ] OSPF over the tunnel (169.254.1.1/.2) → Full. The O route becomes active only after the static route is removed.
- [ ] Lab > WAN: plug wan2. SD-WAN members wan1 + wan2 (the GUI refuses wan1 while policies use it). SLA to 8.8.8.8. ISP1 outage → PC1 still pings via wan2.

## 7. System
- [ ] Admin profile "Set all: Read" + admin with trusted host 192.168.1.110 → login from PC2 refused, from PC1 OK, header shows read-only, saves refused (the form stays open).
- [ ] Three wrong passwords from one host → lockout message.
- [ ] SNMP agent + community → Lab > Mgmt snmpwalk shows sysName. A wrong community → timeout.
- [ ] Log Settings > Remote Logging 10.10.10.30 → "Delivering to NMS-Server" → logs appear in Lab > Mgmt.
- [ ] Firmware: 7.6.0 blocked until 7.4.5. Upgrade → reboot screen → login → v7.4.5 shown.
- [ ] Backup → change something → Restore the file → reboot → change reverted. A junk file shows an error.
- [ ] Idle timeout (5 min default) logs you out.

## 8. Training
- [ ] Labs → Start "Your first firewall policy" (admins are kept) → guide shows 0/4 → tasks tick live → "Lab complete!" → progress 1/19.
- [ ] A challenge: hints reveal 1 → 2 → 3 → solution.
- [ ] Exit lab keeps the config. Restart reloads the lab start.

## 9. Phones and tablets
- [ ] Phone (or a narrow browser window under 760 px): "Best on a computer or tablet" appears once → Continue on this phone → Welcome. Reload: no notice again.
- [ ] ☰ opens the menu over the page; choosing a page or tapping outside closes it. Nothing scrolls sideways except wide tables inside their own area.
- [ ] On a phone, form labels sit above their fields, the Lab panel tabs show icons (tap and hold for names), and the CLI fits the screen.
- [ ] Tablet (760–1024 px): no notice; the menu slides in; the Lab Guide sits beside the page.

## 10. Live site (https://fwallsim.vercel.app)
- [ ] After a push, `npx vercel@latest ls fwallsim` shows the newest deployment as Ready.
- [ ] The live site opens in a private window: login page, no errors in the browser console.
- [ ] First visit on the live site works (Welcome → Create your admin password → Dashboard).
- [ ] Two browsers have separate simulators: a change in one does not appear in the other.
- [ ] Backup on the live site → Restore on http://localhost:5173 brings the same configuration.


## Known limitations in v1.0 (by design)
- HA, multi-VDOM, traffic shaping and security-profile *inspection* are not simulated (menu items marked "later").
- One simulated FortiGate (FWS60F) with a fixed lab network. Everything runs locally in the browser.
