# How FWallSim works

FWallSim is a single-page web app: React 18 + TypeScript, built with Vite 5. There is no backend. A simulated FortiGate, its network and its traffic all run in the browser, and state is kept in browser storage. It is hosted as static files on Vercel (section 10).

## Where data lives

**Short version:** there is no server, database or account system. Vercel (the host) only hands out the same static files to everyone: one HTML page, one script and one stylesheet. After that, everything happens inside each visitor's own browser. The simulator itself makes no network calls; the web addresses you see in it are just text. The one exception is on the hosted site: [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy) sends an anonymous page-view count (page, referrer, country, browser type; no cookies, nothing typed or configured). It is added in `src/main.tsx` and only in production builds, so `npm run dev`, the tests and self-built copies off Vercel send nothing.

```
 Vercel (https://fwallsim.vercel.app)          Visitor's browser (one private copy each)
 ┌────────────────────────────┐   download   ┌──────────────────────────────────────────┐
 │ index.html, script, styles │ ───────────▶ │ The simulated FortiGate, lab network,    │
 │ same files for everyone    │   (once)     │ users and traffic all run here           │
 │ no database, no accounts   │              │                                          │
 └────────────────────────────┘  config is   │ localStorage   config, runtime, UI,      │
                                 never sent  │                training progress         │
                                 back; only  │ sessionStorage who is logged in          │
                                 a page-view └──────────────────────────────────────────┘
                                 count
```

| What | Where it lives | Who can see it | How it goes away |
|---|---|---|---|
| The firewall configuration (policies, addresses, interfaces, VPNs, admins and their passwords, local users) | The visitor's browser, `localStorage` key `fwallsim.config.v1` | Only that browser on that computer | Factory reset, or clearing the site data in the browser |
| Runtime: sessions, traffic and event logs, counters, lab state (cables, ISP outages, logged-in lab users), lockouts, firmware version | `localStorage` `fwallsim.runtime.v1` (only the last 10 traffic results are kept) | Only that browser | Factory reset, Clear logs, or clearing site data |
| Screen state: current page, Lab panel size and tab, sidebar | `localStorage` `fwallsim.ui.v1` | Only that browser | Clearing site data |
| Training progress: finished labs, hints shown, active lab | `localStorage` `fwallsim.training.v1` | Only that browser | **Reset progress** on the Training page, or clearing site data. A factory reset keeps it. |
| Welcome screen already seen | `localStorage` `fwallsim.welcomed.v1` | Only that browser | Clearing site data (a factory reset keeps it) |
| Who is logged in to the GUI | `sessionStorage` `fwallsim.auth.v1` | Only that browser tab session | Logout, idle timeout, or closing the browser |
| Backup files (`.conf`) | Wherever the visitor saves the download | Whoever has the file | Deleting the file |
| Page visits | Vercel's normal request logs (IP address, page, time), like any website, plus Vercel Web Analytics: anonymous, cookie-free page-view counts (hosted site only) | The Vercel account owner (Project → Analytics) | Vercel deletes them after its retention period |

**Users: three kinds, all simulated**

| Kind | What it is | Where it is defined |
|---|---|---|
| GUI/CLI administrators (`admin`, any you add) | Accounts on the simulated FortiGate | In the config (`system admin`), so in the visitor's browser |
| Local firewall users and groups | Users the firewall checks for identity policies and SSL-VPN | In the config (`user local`, `user group`) |
| Directory (AD) users such as `jsmith`, `adoe` | A fake Active Directory server that LDAP/RADIUS tests talk to | Hardcoded in `src/engine/topology.ts` (`DIRECTORY`), the same for everyone |

There are no real FWallSim user accounts. Two visitors never see each other's settings. The same person on two browsers or computers gets two separate simulators; Backup/Restore moves a configuration between them.

**Traffic: all simulated, all local**

No real packets are sent. When you click **Send traffic** (or a lab check runs, or `execute ping` runs in the CLI), `runTraffic()` in `src/engine/packet.ts` works out what a real FortiGate would do with that packet, step by step (see section 2). It then records the Packet Walk, the debug-flow lines, the session, the logs and the counters into the runtime state above. The PCs, servers, ISPs, internet hosts and attacker are entries in `src/engine/topology.ts`. Their answers ("port open", "refused", "no reply") come from that file, not from the real internet.

**Security notes**
- Passwords typed into FWallSim stay in that browser. **Admin passwords** are stored only as a one-way hash, like FortiOS does: `SH2` + 16 hex salt + 64 hex SHA-256 (`src/engine/sha256.ts`, `hashAdminPw()` in `engine/admin.ts`). That applies in `localStorage` and in backups (`set password ENC SH2…`). Passwords typed in the GUI or CLI are hashed on save (`updateConfig`/`commitConfig`), and plain ones from older saves are hashed on load (`migrateConfig`). Other secrets (local-user and LDAP passwords, PSKs) are encoded reversibly, because the simulation has to compare them with the lab's values; they are fictional lab data.
- The lab passwords (`Branch-PSK-2026`, `Bind123!`, `Sales123!` and so on) are fictional and the same for everyone.

## Folder map

```
FWallSim/
├─ src/
│  ├─ main.tsx, App.tsx      entry point; App picks login / password change / boot screen / Layout
│  ├─ store.ts               the single app state and every action (config, runtime, auth, UI, training)
│  ├─ styles.css             all styling, five themes (Jade, Neutrino, Mariner, Graphite, Dark Matter)
│  ├─ engine/                the simulated firewall (no React here)
│  ├─ cli/                   the FortiOS-style CLI
│  ├─ gui/                   the GUI shell, shared widgets and one file per page
│  ├─ lab/                   the Lab panel at the bottom (traffic generator, topology, packet walk, …)
│  └─ labs/labs.ts           the 13 guided labs and 6 challenges, with live checks
├─ tests/                    Node test suites (engine, labs) and the lab reference solutions
├─ e2e/                      Playwright browser tests
├─ course/                   class PDF builder (template, capture scripts, screenshots, PDFs)
├─ media/                    the launch video, its poster and the README's GIF preview
├─ video/              the video's plan, caption, and the scripts that build it (work/)
├─ docs/                     this documentation
├─ start-/stop-fwallsim.*    start/stop scripts (.ps1 Windows, .sh Mac/Linux)
├─ vite.config.ts            dev server on 5173; output folders excluded from file watching
├─ playwright.config.ts      browser tests: own server on 5174, 1 worker
└─ playwright.course.config.ts  PDF build: 1440×900 at 2× scale, on 5174
```

## 1. The configuration (engine/schema.ts, config.ts, defaults.ts, serialize.ts)

The config is shaped like a FortiOS configuration:

```ts
type Config = Record<string, ConfigTable | ConfigObject>;   // key = path, e.g. 'firewall policy'
ConfigTable  = { kind: 'table',  entries: { key: string; f: Fields }[] }   // "edit <key>"
ConfigObject = { kind: 'object', f: Fields }                               // e.g. 'system global'
FieldValue   = string | string[] | ConfigTable | ConfigObject              // nested config blocks
```

- **schema.ts** describes every path and field: type (int, ip, ipmask, option, ref, words, …), default, allowed options, references to other tables, and the help text shown by `?`. The schema drives the CLI (completion, validation, `show` quoting), defaults and serialization. Integer ranges come from the help text ("(1 - 480)") or a small list of known limits in `cli/session.ts`.
- **config.ts** has the helpers: `def`, `entries`, `find`, `str`, `list`, `gobj`, `sub`, `setv`, `nextKey`, `findRefs` (who uses an object), `renameObject` (rename and update every reference), `newUuid`.
- **defaults.ts**: `factoryConfig()` (a new unit), `starterConfig()` (the Small office scenario), `SCENARIOS`, and `migrateConfig()` which upgrades configs saved by older versions (adds new paths, fixes the old hostname, fills admin-profile permissions).
- **serialize.ts**: `serializeConfig()` writes a FortiOS `.conf` (Backup, `show`), `parseConfigText()` reads one (Restore). `APP_VERSION = '1.0.0'`, `FW_VERSION = 'v7.4.4'`. The lab suite checks that every lab config survives this round trip unchanged.

## 2. The network and the packet engine (engine/)

| File | Role |
|---|---|
| `topology.ts` | The fixed lab: hosts (PCs, DMZ servers, internet hosts, attacker, branch, laptop), ISPs, the AD directory, DNS table |
| `lab.ts` | Lab state you change from the Lab panel: logged-in users, VPN clients, cables, ISP outages, latency and loss |
| `net.ts` | `buildNet(config)`: interface IPs, DHCP leases, routes (connected, static, DHCP, BGP, OSPF, SD-WAN), `lookupRoute`, `rpfCheck`, `policyRoute` |
| `packet.ts` | `runTraffic()`: sends one packet through the firewall and returns the result |
| `vpn.ts` | IPsec negotiation with the branch (proposals, PSK, selectors) with real failure reasons; SSL-VPN |
| `auth.ts` | Local, LDAP and RADIUS authentication against the simulated AD; identity policies |
| `dynroute.ts` | BGP with the ISP (AS 64500, you are AS 65010) and OSPF over the tunnel |
| `sdwan.ts` | SD-WAN members, health checks (SLA) and rules |
| `admin.ts` | Admin profiles and permissions (`writeDenied`), trusted hosts, menu permissions |
| `mgmt.ts` | Local-in policies, SNMP agent, remote syslog, firmware upgrade path |
| `runtime.ts` | Runtime state: sessions, logs, history, counters, firmware, lockouts |
| `views.ts`, `objects.ts`, `logfmt.ts` | Read-only views for the GUI, object helpers, FortiOS log formatting |

**The packet flow** follows the FortiOS first-packet path:

ingress → session lookup → destination NAT (VIP) → local-in (local-in policies, then administrative access) → policy route → SD-WAN rule → routing table → reverse-path check → firewall policy (first match wins, implicit deny, user identity) → source NAT → egress (ISP state, IPsec selectors) → the reply comes back through the session.

Each step is recorded twice: as a **Packet Walk** step with a plain-language explanation, and as **`diagnose debug flow`** trace lines. Packets also feed the sniffer and the logs.

## 3. The store (store.ts)

One state object, read in React with `useSyncExternalStore` (`useStore(selector)`):

| Part | Saved in | Contents |
|---|---|---|
| `config` | localStorage | the FortiOS-style configuration |
| `runtime` | localStorage | sessions, logs, history, lab state, lockouts, firmware |
| `ui` | localStorage | current page, dock size/tab, sidebar |
| `training` | localStorage | completed labs, hints shown, active lab |
| `auth` | sessionStorage | who is logged in (a new browser session asks again) |
| `rev`, `revPaths` | memory | bumped when the config changes outside the GUI forms |

Key actions: `updateConfig` (GUI saves, checks permissions), `commitConfig` (CLI saves), `replaceConfig` (Restore), `loadScenario`, `startLab` / `exitLab`, `login` (reachability, trusted hosts, lockout), `sendTraffic`, `factoryReset`, `reboot`, `firmwareUpgrade`.

**Outside changes and open pages.** When the CLI, a restore, a scenario or a lab changes the config, the store records which top-level paths changed (`revPaths`). The layout reloads the open page only if those paths are ones that page edits (`PAGE_PATHS` in `gui/Layout.tsx`). Stale values can't be re-applied, and unrelated CLI work doesn't wipe unsaved edits.

## 4. The GUI (gui/)

- **Layout.tsx**: the header (brand, hostname, Labs, `>_` CLI, admin menu with Backup/Restore/Reboot), the sidebar filtered by the admin's permissions, the page area (each page wrapped in `PageBoundary` so one broken page can't blank the app; scroll resets on navigation), the Lab panel and the Lab Guide.
- **menu.ts**: the menu tree. Items not simulated yet have `phase` set and show a "later" badge (they open `ComingSoon`).
- **ui.tsx**: shared widgets (Field, Toggle, Seg, Modal, Confirm, ContextMenu, Dropdown, PageBoundary, …).
- **picker.tsx**: the FortiOS-style entry picker drawer (choose interfaces, addresses, services).
- **ObjectList.tsx**, **save.ts**: generic list pages and `saveEntry` (create/rename/update with validation and references).
- **pages/**: one file per page. List pages edit one entry at a time; settings pages edit one config object and save on Apply.

## 5. The CLI (cli/)

- **session.ts**: `CliSession` keeps a stack of frames (`config` → `edit` → nested `config`), works on a draft, and commits on `end`/`next`. It validates values (types, ranges, datasources, required attributes such as `Attribute 'srcintf' MUST be set.`), enforces admin permissions (`Permission denied`), and handles `show`, `get`, `diagnose`, `execute`, pipes (`| grep`), the live debug flow, the sniffer and IKE debug.
- **words.ts**: command trees and unique-prefix resolution (`conf sys int`).
- **outputs.ts**: the text of `get`/`diagnose` outputs.
- **gui/Cli.tsx**: the console window (Tab completion, `?`, history, Ctrl+C, Ctrl+L).

## 6. Training (labs/labs.ts)

Each lab: `id`, `title`, `level`, `minutes`, `topic`, `intro`, `build()` (start config), optional `lab` (cables, outages), `startPage`, and `tasks` (`title`, `how`, `check(ctx)`). Checks inspect the config and send **real simulated traffic** (`ctx.send`), so a task only turns green when it truly works. Challenges add `hints` and a `solution`. The Lab Guide re-checks on every change and every few seconds (for CLI-only changes).

## 7. Tests

| Suite | File(s) | How it runs |
|---|---|---|
| Engine and CLI | `tests/engine.test.ts` | bundled with esbuild, run in Node with `tests/stubs.ts` (fake localStorage/window) |
| Labs | `tests/labs.test.ts` + `tests/solutions.ts` | every lab: starts unsolved, the reference solution makes it pass, the config survives backup/restore |
| Browser | `e2e/*.spec.ts` | Playwright + Chromium on port 5174; any browser error fails the test (`e2e/helpers.ts`) |
| Page sweep | `e2e/10-sweep.spec.ts` | opens every page on a fresh and a busy unit: untouched Apply, edit-and-OK, Create New/Cancel |
| Visual | `e2e/visual.spec.ts` | saves review screenshots to `e2e-results/screens` |

`tests/solutions.ts` is also loaded inside the browser (through the dev server) by the course and video capture scripts, to solve labs instantly.

## 8. The course PDFs (course/)

`template.ts` renders a class (cover, goals, lab diagram, steps, screenshots, hints, solution, next class) to HTML with print CSS. The capture scripts drive the real app with Playwright and draw numbered red markers on elements. `2-build.course.ts` builds one class per lab plus Class 00 and prints A4 PDFs with page numbers through Chromium.

## 9. The launch video (video/)

`work/capture.cjs` drives the real app and saves two screenshots, plus the real HTML of the traffic results, Packet Walk, CLI window and Lab Guide (`shots/parts.json`). `work/video.html` is a 1920×1080 page where `render(t)` draws the frame for time `t` (every frame is a pure function of time). It loads the app's own `src/styles.css`, so the captured UI renders exactly as in the app, as sharp vector graphics at any size, and animates it: Packet Walk steps appear one by one, the CLI types, lab tasks tick. `render.cjs` captures 687 frames, `audio.py` synthesizes original music and effects, and ffmpeg encodes `media/fwallsim-tour.mp4` with the poster (the settled Packet Walk) as frame 0, plus the GIF preview shown in the README.

## 10. Hosting

The public GitHub repo is connected to a Vercel project (Vite preset, `npm run build`, output `dist`). Each push to `main` builds and publishes https://fwallsim.vercel.app in about 15 seconds. Vercel's long per-deploy preview links sit behind a Vercel login by default; the main address is public.

## Ports

| Port | Used by |
|---|---|
| 5173 | FWallSim (start scripts, `npm run dev`) |
| 5174 | The test and course servers (started and stopped by Playwright) |
| 5175 | The video capture server (make-video) |
| 5176 | Serves the project folder so `video.html` can load its captures (make-video) |
