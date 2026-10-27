#!/usr/bin/env bash
# PulseGrid Linux MIDI setup — idempotent, safe to re-run.
# Installs bridge deps, ensures an ALSA virtual MIDI port exists,
# and prints the available ports for DAW routing.
set -euo pipefail

PORT_NAME="${1:-PulseGrid VST Out}"

echo "==> PulseGrid Linux MIDI setup (port: '$PORT_NAME')"

# 1. Python deps for bridge/vst-bridge-linux.py
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found. Install it first (e.g. sudo apt install python3 python3-pip)." >&2
  exit 1
fi
echo "==> Installing Python deps (mido, python-rtmidi, websockets)…"
python3 -m pip install --user --upgrade mido python-rtmidi websockets 2>&1 | tail -2 || {
  echo "WARN: pip install failed — try: sudo apt install python3-mido python3-rtmidi" >&2
}

# 2. ALSA virtual MIDI (snd-virmidi) so DAWs see ports without JACK
if [ ! -d /proc/asound ]; then
  echo "WARN: no ALSA (/proc/asound missing). On containers/WSL, MIDI ports may not work." >&2
else
  if lsmod 2>/dev/null | grep -q snd_virmidi; then
    echo "==> snd-virmidi already loaded."
  else
    echo "==> Loading snd-virmidi (needs sudo)…"
    if sudo modprobe snd-virmidi midi_devs=1 2>/dev/null; then
      echo "==> snd-virmidi loaded."
      if [ -d /etc/modules-load.d ] && [ -w /etc/modules-load.d ]; then
        echo "snd-virmidi" | sudo tee /etc/modules-load.d/pulsegrid-virmidi.conf >/dev/null || true
      else
        echo "snd-virmidi" | sudo tee /etc/modules-load.d/pulsegrid-virmidi.conf >/dev/null 2>&1 || \
          echo "NOTE: could not persist module load; re-run modprobe after reboot."
      fi
    else
      echo "WARN: could not modprobe snd-virmidi. The Python bridge creates its own virtual port anyway." >&2
    fi
  fi
fi

# 3. Realtime hint for JACK users (optional, non-fatal)
if command -v jackd >/dev/null 2>&1; then
  echo "==> JACK detected — you can route with qjackctl / jack_lsp."
fi

# 4. Show current MIDI ports
echo "==> Current MIDI ports (aconnect):"
if command -v aconnect >/dev/null 2>&1; then
  aconnect -l || true
else
  echo "    (install alsa-utils for 'aconnect -l')"
fi

echo ""
echo "Done. Start the bridge with:"
echo "  python3 bridge/vst-bridge-linux.py --port 8080 --midi-port \"$PORT_NAME\""
echo "Then enable '$PORT_NAME' as a MIDI input in Ardour / Reaper / Bitwig / Carla."
