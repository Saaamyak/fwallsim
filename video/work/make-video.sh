#!/bin/bash
# Rebuilds media/fwallsim-tour.mp4 (and its poster and GIF preview) from scratch (macOS / Linux).
# Needs: node_modules installed, Playwright Chromium, ffmpeg, and python3 with numpy + pillow
# (one time: python3 -m venv video/work/.venv && video/work/.venv/bin/pip install numpy pillow).
# Usage (from the project root):  bash video/work/make-video.sh
set -e
cd "$(dirname "$0")/../.."          # project root
WORK=video/work
PY="$PWD/$WORK/.venv/bin/python"
[ -x "$PY" ] || PY=python3

echo "1/6 Capturing the real app (private server on port 5175)..."
FWALLSIM_E2E=1 npx vite --port 5175 --strictPort > /dev/null 2>&1 &
VITE=$!
python3 -m http.server 5176 --bind 127.0.0.1 > /dev/null 2>&1 &
HTTP=$!
trap 'kill $VITE $HTTP 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null http://localhost:5175 && break; sleep 0.5; done
node $WORK/capture.cjs
kill $VITE 2>/dev/null || true

echo "2/6 Generating the soundtrack (audio.wav)..."
(cd $WORK && "$PY" audio.py)

echo "3/6 Rendering 687 frames from video.html (served on port 5176)..."
node $WORK/render.cjs

echo "4/6 Poster frame (t = 13.6 s, the settled Packet Walk) as the poster and as frame 0..."
"$PY" -c "from PIL import Image; Image.open('$WORK/frames/f00408.png').convert('RGB').save('media/fwallsim-tour-poster.jpg', quality=92)"
cp $WORK/frames/f00408.png $WORK/frames/f00000.png

echo "5/6 Encoding the video..."
ffmpeg -y -loglevel error -framerate 30 -i $WORK/frames/f%05d.png -i $WORK/audio.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart media/fwallsim-tour.mp4

echo "6/6 GIF preview for the README (800 px, 10 fps)..."
ffmpeg -y -loglevel error -ss 0.05 -i media/fwallsim-tour.mp4 \
  -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" media/fwallsim-tour.gif
echo "Done: media/fwallsim-tour.mp4, media/fwallsim-tour-poster.jpg, media/fwallsim-tour.gif"
