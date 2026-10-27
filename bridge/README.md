# PulseGrid VST Bridge — Linux guide

The bridge connects the browser UI to your DAW / plugins over two hops:

```
PulseGrid UI --WebSocket :8080--> bridge daemon --virtual MIDI--> DAW / VST host
```

Chrome on Linux can also talk to ALSA/JACK ports **directly via WebMIDI**
(pick them in the VST drawer) — no daemon needed for that path.

## 1. One-time setup

```bash
chmod +x bridge/setup-linux-midi.sh
./bridge/setup-linux-midi.sh
```

This installs `mido`, `python-rtmidi`, `websockets`, loads `snd-virmidi`
(persisted via `/etc/modules-load.d`), and lists your MIDI ports.

## 2. Run the bridge

```bash
python3 bridge/vst-bridge-linux.py --port 8080 --midi-port "PulseGrid VST Out"
```

In the PulseGrid VST drawer: **Connect** → **Auto-calibrate** → play.
In your DAW, enable **"PulseGrid VST Out"** as a MIDI input:

| DAW | Where |
| --- | --- |
| Ardour | Window → MIDI Connections, or track input selector |
| Reaper | Track → Input: MIDI → PulseGrid VST Out |
| Bitwig | Note Receiver / HW Instrument → PulseGrid VST Out |
| Carla | Patchbay → connect `PulseGrid VST Out` to the plugin |

No ports visible? `aconnect -l` to list, `aconnect <src> <dst>` to wire
manually. JACK users: the port shows up in qjackctl / `jack_lsp`.

## 3. Headless / auto-start (systemd user service)

```bash
cp bridge/pulsegrid-bridge.service ~/.config/systemd/user/
# edit ExecStart to your checkout path, then:
systemctl --user daemon-reload
systemctl --user enable --now pulsegrid-bridge
journalctl --user -u pulsegrid-bridge -f
```

## 4. Per-track routing

In code, each track can carry its own route (wins over drawer overrides,
which win over the global defaults):

```js
track("bass").vst("Carla Rack (Linux)").vstChannel(2).pattern("f1 ~ [f1 ab1] c2");
track("keys").vst({ plugin: "Vital (External VST3)", channel: 3 }).pattern("c3 eb3 g3");
```

`.vst()` autocomplete in the editor lists your detected MIDI ports.

## 5. Troubleshooting

- **"No bridge on ws://…"** — the daemon isn't running; start it (§2).
- **WebMIDI unavailable** — use Chrome/Edge (Firefox lacks WebMIDI).
- **Notes arrive late** — hit **Auto-calibrate** in the drawer; it halves
  the WS round-trip, adds the browser audio latency, and sets the offset.
- **Permission denied on /dev/snd/seq** — add yourself to the `audio` group
  and re-login: `sudo usermod -aG audio $USER`.
