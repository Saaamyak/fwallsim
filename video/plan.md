# FWallSim: launch video plan (v2, for hands-on learners)

**What it is:** a practice FortiGate-style firewall that runs in your browser, with a GUI, a CLI, a lab network to send traffic through, and guided labs.
**Who it's for:** people who want to learn firewalls by doing: beginners, students, junior network and security engineers.
**What it does for them:** they configure a real-looking firewall, send traffic, and see exactly why it was allowed or blocked. No hardware, licence or trial.
**What sets it apart:** the Packet Walk explains every decision in plain words, and lab tasks only tick green when simulated traffic proves the setup works.
**Most impressive claim:** 19 hands-on labs, from first login to BGP, free in a browser tab.
**Visual hook:** the very first thing a new firewall does is block you: a red "Denied by implicit deny" result, then "Can you fix it?"
**Real UI shown:** the Welcome screen, the traffic result (denied → allowed), the Edit Policy form (Action ACCEPT, NAT), the Packet Walk, the CLI debug flow, and the Lab Guide ticking green. The results, Packet Walk, CLI and Lab Guide are the app's real HTML, captured from the running app and drawn with its own `src/styles.css`.
**Tone:** `default` with a teaching voice: an invitation, a challenge, then the payoff. No jokes at the learner's expense.
**Share caption:** Your first firewall blocks everything. FWallSim lets you fix it yourself: a FortiGate-style firewall in your browser, a Packet Walk that explains every decision, and 19 hands-on labs.

## Identity
- Stage: the app's dark header colours (#263133 / #1d2627), with a slow green grid. Accent green #2f8f5b / #3fbf7a, logo red #e8392f (from the app).
- Type: the app's own font stack (Lato → Helvetica Neue on a Mac). The CLI uses the app's mono stack (Menlo on a Mac).

## Storyboard (22.5 s, 1920×1080, 30 fps)
| # | Time | Scene | On screen |
|---|---|---|---|
| 1 | 0.0–3.2 | Hook | "Your new firewall just blocked the internet." Then the real red result row slams in: *Denied by implicit deny: no policy allows internal → wan1*. At 2.1 s: **"Can you fix it?"** |
| 2 | 3.2–6.6 | Reveal | Logo + **"Learn firewalls hands-on."** + "A practice firewall in your browser. No hardware. No trial." Right: the real Welcome screen; the Get started button pulses |
| 3 | 6.6–10.4 | Build | **"Build the policy yourself."** / "Interfaces, ACCEPT, NAT. Like on a real FortiGate." Right: the real Edit Policy form; highlights land on Action ACCEPT, then NAT. The result row flips to green: *allowed by policy 1* |
| 4 | 10.4–14.2 | See | **"Watch every packet decide."** / "Route, policy, NAT. Every step in plain words." Right: the real Packet Walk; steps appear one by one; "Allowed by policy 1" glows |
| 5 | 14.2–17.0 | Debug | **"Real commands, too."** / `diagnose debug flow`, `show`, `get`, Tab to complete. Right: the CLI types the debug commands; real trace lines print; "Allowed by Policy-1: SNAT" lights up |
| 6 | 17.0–19.8 | Learn | **"19 hands-on labs."** / "A task ticks green only when it really works." Right: the real Lab Guide; tasks tick 1 → 4; "Lab complete!" |
| 7 | 19.8–22.5 | Outro | Logo, **"Learn firewalls by doing."**, the pill `fwallsim.vercel.app`, then "Free · Runs in your browser · Not affiliated with Fortinet" |

Transitions dip through the dark stage (old scene out, then new in), so busy layouts never double-expose.

## Sound
An original track made for this cut: 112 BPM in D minor (Dm–B♭–F–C), a warm pad, a soft plucked arpeggio, a light kick from the reveal on, and hats from the Build scene. Effects are tuned to the key and mixed under the music:
- a low "thud" when the Denied row lands
- a soft rising chime on "Can you fix it?"
- quiet key clicks under the CLI typing
- pentatonic plinks on each green tick
- soft whooshes on scene changes
- a warm resolve on the outro logo

## Poster
The settled Packet Walk frame (all steps shown, policy step glowing, title fully in), at about 13.6 s. It's baked in as frame 0.
