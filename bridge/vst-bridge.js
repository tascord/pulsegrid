// PulseGrid VST Bridge — universal Node.js version (macOS / Windows / Linux)
// npm i -g easymidi ws   (Linux: also needs ALSA dev headers for easymidi)
// node vst-bridge.js --port 8080 --midi "PulseGrid VST Out"
//
// Linux note: easymidi uses ALSA. Create a virtual port first if needed:
//   sudo modprobe snd-virmidi midi_devs=1
// Or use the Python bridge (bridge/vst-bridge-linux.py) which is preferred on Linux.

const WebSocket = require('ws');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const midiIdx = args.indexOf('--midi');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) || 8080 : 8080;
const PORT_NAME = midiIdx >= 0 ? args[midiIdx + 1] : 'PulseGrid VST Out';

let output = null;
try {
  const midi = require('easymidi');
  output = new midi.Output(PORT_NAME, true);
  console.log(`[bridge] virtual MIDI out: '${PORT_NAME}'`);
} catch (e) {
  console.warn('[bridge] easymidi unavailable, running in WS-only monitor mode:', e.message);
  console.warn('[bridge] Linux tip: use bridge/vst-bridge-linux.py instead.');
}

const wss = new WebSocket.Server({ port: PORT });
console.log(`[bridge] PulseGrid VST Bridge active on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('[bridge] browser connected');
  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', nonce: data.nonce }));
      return;
    }
    if (!output) {
      console.log('[monitor]', JSON.stringify(data));
      return;
    }
    const ch = Math.max(0, Math.min(15, data.channel || 0));
    if (data.type === 'note') {
      const note = Math.max(0, Math.min(127, data.note));
      const vel = Math.max(1, Math.min(127, Math.floor((data.velocity || 0.9) * 127)));
      output.send('noteon', { note, velocity: vel, channel: ch });
      setTimeout(() => {
        output.send('noteoff', { note, velocity: 0, channel: ch });
      }, Math.max(30, (data.duration || 0.4) * 1000));
    } else if (data.type === 'cc') {
      output.send('cc', {
        controller: data.cc || 74,
        value: Math.max(0, Math.min(127, Math.floor((data.value || 0) * 127))),
        channel: ch,
      });
    }
  });
});
