#!/usr/bin/env python3
"""
PulseGrid VST Bridge — Linux / macOS / Windows (Python)
Works on Linux with ALSA virtual MIDI (no JACK required).

  pip install mido python-rtmidi websockets
  python3 vst-bridge-linux.py --port 8080 --midi-port "PulseGrid VST Out"

Then in your DAW / plugin host, enable the "PulseGrid VST Out" MIDI input,
or route it with `aconnect -l` / `aconnect <src> <dst>`.

On Linux, if no MIDI ports appear:
  sudo modprobe snd-virmidi midi_devs=1
  # or use JACK: qjackctl -> Connections -> PulseGrid VST Out

Protocol (JSON over ws://localhost:PORT):
  {type:"note", note:60, velocity:0.9, duration:0.4, channel:0}
  {type:"cc", cc:74, value:0.5, channel:0}
  {type:"ping", nonce:"..."} -> {type:"pong", nonce:"..."}
"""
import argparse
import asyncio
import json
import sys

try:
    import mido
except ImportError:
    print("Missing dependency: pip install mido python-rtmidi websockets", file=sys.stderr)
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("Missing dependency: pip install websockets", file=sys.stderr)
    sys.exit(1)


def parse_args():
    p = argparse.ArgumentParser(description="PulseGrid VST Bridge (Linux-ready)")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--midi-port", default="PulseGrid VST Out")
    p.add_argument("--channel", type=int, default=0, help="Default MIDI channel 0-15")
    return p.parse_args()


async def handle(ws, outport, default_channel):
    print(f"[bridge] browser connected: {ws.remote_address}")
    try:
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            kind = data.get("type")
            if kind == "ping":
                await ws.send(json.dumps({"type": "pong", "nonce": data.get("nonce")}))
            elif kind == "note":
                note = int(data.get("note", 60))
                vel = float(data.get("velocity", 0.9))
                dur = float(data.get("duration", 0.4))
                ch = int(data.get("channel", default_channel))
                velocity = max(1, min(127, int(vel * 127)))
                outport.send(mido.Message("note_on", note=note, velocity=velocity, channel=ch))
                await asyncio.sleep(max(0.03, dur))

                outport.send(mido.Message("note_off", note=note, velocity=0, channel=ch))
            elif kind == "cc":
                cc = int(data.get("cc", 74))
                val = float(data.get("value", 0.0))
                ch = int(data.get("channel", default_channel))
                outport.send(
                    mido.Message(
                        "control_change",
                        control=cc,
                        value=max(0, min(127, int(val * 127))),
                        channel=ch,
                    )
                )
    except websockets.ConnectionClosed:
        print("[bridge] browser disconnected")


async def main():
    args = parse_args()
    try:
        outport = mido.open_output(args.midi_port, virtual=True)
    except Exception as e:
        print(f"[bridge] could not open virtual MIDI port: {e}", file=sys.stderr)
        print("[bridge] available backends:", mido.Backend().name if hasattr(mido, "Backend") else "?")
        print("[bridge] try: sudo modprobe snd-virmidi midi_devs=1", file=sys.stderr)
        sys.exit(2)

    print(f"[bridge] MIDI out: '{args.midi_port}' (virtual, Linux ALSA/JACK compatible)")
    print(f"[bridge] WebSocket: ws://localhost:{args.port}")
    print("[bridge] In your DAW: enable 'PulseGrid VST Out' as MIDI input.")

    async def handler(ws):
        await handle(ws, outport, args.channel)

    async with websockets.serve(handler, "127.0.0.1", args.port):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[bridge] stopped.")
