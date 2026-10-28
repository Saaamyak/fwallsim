# How to: everyday tasks

All commands run from the project folder. On Windows use PowerShell; on a Mac use Terminal. Where they differ, both are shown.

## Run the app

| | Windows | Mac |
|---|---|---|
| Start (background, opens the browser) | `powershell -ExecutionPolicy Bypass -File .\start-fwallsim.ps1` | `./start-fwallsim.sh` |
| Stop | `powershell -ExecutionPolicy Bypass -File .\stop-fwallsim.ps1` | `./stop-fwallsim.sh` |
| Start in the foreground (Ctrl+C stops) | `npm run dev` | `npm run dev` |

The app is at http://localhost:5173 (or online at https://fwallsim.vercel.app). First visit: Welcome → create your admin password. After that, log in as `admin` with it. Startup problems are written to `fwallsim.log`.

**Forgot the admin password or locked out?** Login page → "Forgot password or locked out? Reset to factory defaults". This erases the simulated configuration but keeps training progress.

## Run the tests

```bash
npx playwright install chromium   # one time per computer
npm test                          # everything (about 6 minutes)
```

| Command | What it runs | Expected |
|---|---|---|
| `npm run typecheck` | TypeScript type check | no output |
| `npm run test:engine` | Engine and CLI checks ([tests/engine.test.ts](../tests/engine.test.ts)) | `57 passed, 0 failed` |
| `npm run test:labs` | Every lab starts unsolved, the reference solution solves it, and the config survives backup/restore ([tests/labs.test.ts](../tests/labs.test.ts)) | `ALL 19 LABS SOLVABLE` |
| `npm run e2e` | Browser tests in Chromium ([e2e/](../e2e)) | `41 passed` |
| `npx playwright test e2e/09-qa.spec.ts` | One browser test file | |
| `npx playwright test -g "lockout"` | Browser tests whose name matches | |

Failed browser tests leave a screenshot and a trace in `e2e-results/`. Open a trace with `npx playwright show-trace <path>/trace.zip`.

The browser tests start their own server on port 5174, so they don't clash with a running FWallSim on 5173. Don't edit source files while `npm test` runs: the test server reloads on every change and tests fail with blank pages.

## Rebuild the class PDFs

```bash
npx playwright install chromium   # one time
npm run course
```

This takes about 2 minutes:
1. [course/1-capture.course.ts](../course/1-capture.course.ts) captures annotated screenshots for Classes 1–8 into `course/img/c01…c08`.
2. [course/1b-labs.course.ts](../course/1b-labs.course.ts) starts and solves the other labs and captures them into `course/img/<lab-id>`.
3. [course/2-build.course.ts](../course/2-build.course.ts) builds one class per lab from [src/labs/labs.ts](../src/labs/labs.ts), plus Class 00 (the course plan), using [course/template.ts](../course/template.ts), and prints them to `course/pdf/`.

To rebuild only the PDFs from existing screenshots: `npx playwright test -c playwright.course.config.ts 2-build`.

To change what a class says, edit the lab in `src/labs/labs.ts` (title, intro, task titles, "how" text, hints, solution) and rebuild. The PDFs and the in-app Lab Guide stay in sync that way.

## Rebuild the launch video

The current video (v2, 2026-10-27) is for people who want to learn firewalls hands-on: a factory unit blocks PC1 ("Can you fix it?"), then the Welcome screen, building the policy, the Packet Walk, the CLI debug flow and a lab ticking green (22.9 s, 1080p, original music).

Requirements: `ffmpeg` (`brew install ffmpeg`), Playwright Chromium, and Python with `numpy` and `pillow`. One time:
```bash
python3 -m venv video/work/.venv && video/work/.venv/bin/pip install numpy pillow
```

**Mac / Linux:** `bash video/work/make-video.sh` (about 3 minutes)

**Windows** (same steps by hand, from the project root):
```powershell
$env:FWALLSIM_E2E = '1'; Start-Process npx -ArgumentList 'vite --port 5175 --strictPort' -WindowStyle Hidden
Start-Process python -ArgumentList '-m http.server 5176 --bind 127.0.0.1' -WindowStyle Hidden
node video/work/capture.cjs          # real UI from the app on 5175
cd video/work; python audio.py; cd ../..
node video/work/render.cjs           # 687 frames from video.html on 5176
# copy frames/f00408.png to media/fwallsim-tour-poster.jpg (as JPEG) and over frames/f00000.png, then:
ffmpeg -y -framerate 30 -i video/work/frames/f%05d.png -i video/work/audio.wav -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart media/fwallsim-tour.mp4
# and the README preview: see step 6 in make-video.sh (ffmpeg to media/fwallsim-tour.gif)
# stop both servers afterwards
```

What each file does:

| File | Role |
|---|---|
| `video/plan.md` | The angle and storyboard (7 scenes, 22.9 s) |
| `work/capture.cjs` | Drives the real app on port 5175. It saves the Welcome and Edit Policy screenshots, the real HTML of the denied/allowed results, Packet Walk, CLI and Lab Guide (before/after), and element positions to `work/shots/` (`parts.json`) |
| `work/video.html` | The video as a web page: `render(t)` draws the frame for time `t`. It loads the app's own `src/styles.css`, so the captured UI looks exactly as in the app. It must be served over HTTP (port 5176), not opened as a file |
| `work/stills.cjs` | `node video/work/stills.cjs 2.0 8.5 …` saves single frames to `work/stills/` for checking |
| `work/render.cjs` | Saves all 687 frames (30 fps) to `work/frames/` |
| `work/audio.py` | Generates the original soundtrack `audio.wav` (112 BPM, D minor, effects timed to the scenes) |
| `work/make-video.sh` | All of the above, plus the poster, the ffmpeg encode and the GIF preview |
| `media/fwallsim-tour.mp4`, `-poster.jpg`, `.gif` | The results: the video, its poster, and the preview the README shows (GitHub only plays videos uploaded through its website, so the README shows the GIF and links to the MP4) |

To change the timing, edit `SCENES` and the times in `render(t)` in `video.html`, and the event times in `audio.py`. Only the scripts are in Git; frames, stills, captures and audio are rebuilt.

## Build for hosting

```bash
npm run build      # type check + production build into dist/ (about 680 KB)
npm run preview    # serve dist/ locally to check it
```

## Publish to GitHub and a free host

FWallSim is a static site (no server, no database), so any free static host works.

### How the official site is hosted

| | |
|---|---|
| Live site | https://fwallsim.vercel.app |
| Code | https://github.com/Saaamyak/fwallsim (public, branch `main`) |
| Host | Vercel (free Hobby plan), connected to the GitHub repo: Vite preset, `npm run build`, output `dist` |

**Update the live site:** commit and `git push`. Vercel builds and publishes in about 15 seconds. Run `npm test` before pushing.

**Check or roll back** (needs the Vercel CLI, `npx vercel@latest login`, and access to the project):
```bash
npx vercel@latest ls fwallsim                 # recent deployments and their status
npx vercel@latest inspect <deployment-url> --logs   # build log of one deployment
npx vercel@latest rollback <deployment-url>   # put an earlier deployment back live
```
Or use the Vercel website: Project → Deployments.

The steps below are how it was set up, kept for a fresh start or another host.

### Keep your email private (do this first)
Every Git commit records an email address, and GitHub shows it publicly.
1. github.com → **Settings → Emails**: tick **Keep my email addresses private** and **Block command line pushes that expose my email**.
2. Copy your noreply address (like `12345678+yourname@users.noreply.github.com`).
3. Tell Git to use it:
   ```bash
   git config --global user.name "yourname"
   git config --global user.email "12345678+yourname@users.noreply.github.com"
   ```

### Commit and push
The project already has a Git repository (`git init` was run, nothing committed yet) and a `.gitignore` that keeps out `node_modules`, build and test output, video frames, logs, local tool settings and any `.env` or key files.

```bash
git add .
git status            # check: about 130 files, no node_modules, no .env
git commit -m "FWallSim v1.0.0"
```
On github.com: **+ → New repository** → name `fwallsim` → Public or Private → do **not** add a README, .gitignore or license → Create. Then:
```bash
git remote add origin https://github.com/yourname/fwallsim.git
git push -u origin main
```
Sign in through the browser window that opens. Never put passwords or tokens in project files.

### Connect a host (all free)

| Host | Steps |
|---|---|
| **Cloudflare Pages** (unlimited bandwidth) | Workers & Pages → Create → Pages → Connect to Git → `fwallsim` → preset **Vite**, build `npm run build`, output `dist` → Deploy |
| **Vercel** | Add New → Project → import `fwallsim` (Vite is detected) → Deploy |
| **Netlify** | Add new site → Import from Git → `fwallsim`, build `npm run build`, publish `dist` → Deploy |

After that, every `git push` redeploys the site. Each visitor gets a private simulator in their own browser; nobody can see or change anyone else's.

### Is anything secret?
No. The project has no API keys, tokens or `.env` files. The passwords visible in labs (for example `Branch-PSK-2026`) are fictional training data. The admin password you set in FWallSim stays in your browser and never reaches a file.

## Add a new lab (and class)

1. In [src/labs/labs.ts](../src/labs/labs.ts), add an entry to `LABS`: `id`, `title`, `level`, `minutes`, `topic`, `intro`, `build()` (the starting config), optional `lab` (lab-state such as cables), `startPage`, and `tasks` (each with `title`, `how` and a `check`).
2. In [tests/solutions.ts](../tests/solutions.ts), add the reference solution under the same `id`.
3. `npm run test:labs` must show the new lab as PASS.
4. Optional: add the lab to `LABS` in [course/1b-labs.course.ts](../course/1b-labs.course.ts) for screenshots, then `npm run course`. The new class PDF appears automatically.
