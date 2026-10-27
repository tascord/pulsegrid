import { MidiBinding, MidiRecordedClip } from '../types/music';

export interface MidiLearningTarget {
  targetType: 'track' | 'master' | 'send';
  trackId?: string;
  param: 'gain' | 'pan' | 'cutoff' | 'resonance' | 'reverbSend' | 'delaySend' | 'cpm';
  label: string;
}

class MidiManager {
  private midiAccess: MIDIAccess | null = null;
  private isSupported: boolean = false;
  private inputs: MIDIInput[] = [];
  private outputs: MIDIOutput[] = [];
  private bindings: MidiBinding[] = [];
  private learningTarget: MidiLearningTarget | null = null;

  // Recording state
  private isRecording: boolean = false;
  private recordingStartBeat: number = 0;
  private activeNoteOns: Map<number, { note: number; velocity: number; startBeat: number }> = new Map();
  private recordedNotes: MidiRecordedClip['notes'] = [];
  private recordedClips: Map<string, MidiRecordedClip> = new Map();

  // Activity monitors
  private lastActivity: { type: 'note' | 'cc'; data: number[]; text: string; time: number } | null = null;
  private listeners: Set<() => void> = new Set();
  private paramChangeCallback: ((binding: MidiBinding, normalizedValue: number) => void) | null = null;
  private liveNoteCallback: ((note: number, velocity: number, isNoteOn: boolean) => void) | null = null;

  constructor() {
    this.checkSupport();
    this.loadBindings();
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public onParamChange(callback: (binding: MidiBinding, normalizedValue: number) => void) {
    this.paramChangeCallback = callback;
  }

  public onLiveNote(callback: (note: number, velocity: number, isNoteOn: boolean) => void) {
    this.liveNoteCallback = callback;
  }

  private checkSupport() {
    this.isSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  public async requestAccess(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.refreshDevices();

      this.midiAccess.onstatechange = () => {
        this.refreshDevices();
      };
      this.notify();
      return true;
    } catch (err) {
      console.warn('Web MIDI Access request denied or failed:', err);
      return false;
    }
  }

  public getInputs(): MIDIInput[] {
    return this.inputs;
  }

  public getOutputs(): MIDIOutput[] {
    return this.outputs;
  }

  public getBindings(): MidiBinding[] {
    return this.bindings;
  }

  public getLearningTarget(): MidiLearningTarget | null {
    return this.learningTarget;
  }

  public getLastActivity() {
    return this.lastActivity;
  }

  public isRecordingActive(): boolean {
    return this.isRecording;
  }

  public getRecordedClips(): MidiRecordedClip[] {
    return Array.from(this.recordedClips.values());
  }

  public getClip(name: string): MidiRecordedClip | undefined {
    return this.recordedClips.get(name.toLowerCase());
  }

  public startLearn(target: MidiLearningTarget) {
    this.learningTarget = target;
    this.notify();
  }

  public cancelLearn() {
    this.learningTarget = null;
    this.notify();
  }

  public removeBinding(id: string) {
    this.bindings = this.bindings.filter((b) => b.id !== id);
    this.saveBindings();
    this.notify();
  }

  public startRecording(currentBeat: number) {
    this.isRecording = true;
    this.recordingStartBeat = currentBeat;
    this.recordedNotes = [];
    this.activeNoteOns.clear();
    this.notify();
  }

  public stopRecording(currentBeat: number, clipName?: string): MidiRecordedClip {
    this.isRecording = false;

    // Close any dangling note-ons
    this.activeNoteOns.forEach((active) => {
      this.recordedNotes.push({
        note: active.note,
        velocity: active.velocity,
        startBeat: active.startBeat,
        durationBeats: Math.max(0.25, currentBeat - active.startBeat),
      });
    });
    this.activeNoteOns.clear();

    const name = (clipName || `midi_take_${this.recordedClips.size + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const totalDuration = Math.max(4, Math.ceil(currentBeat - this.recordingStartBeat));

    const clip: MidiRecordedClip = {
      id: `clip_${Date.now()}`,
      name,
      durationBeats: totalDuration,
      notes: this.recordedNotes,
    };

    this.recordedClips.set(name, clip);
    this.notify();
    return clip;
  }

  private refreshDevices() {
    if (!this.midiAccess) return;
    this.inputs = [];
    this.outputs = [];

    this.midiAccess.inputs.forEach((input) => {
      this.inputs.push(input);
      input.onmidimessage = (event) => this.handleMidiMessage(event);
    });

    this.midiAccess.outputs.forEach((output) => {
      this.outputs.push(output);
    });

    this.notify();
  }

  private handleMidiMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length < 2) return;

    const status = data[0];
    const command = status >> 4;
    const channel = (status & 0xf) + 1;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    // CC Message: command 0xB (11)
    if (command === 11) {
      const ccNumber = d1;
      const ccValue = d2 / 127; // normalized 0..1

      this.lastActivity = {
        type: 'cc',
        data: [status, d1, d2],
        text: `CC ${ccNumber} : ${d2} (ch ${channel})`,
        time: Date.now(),
      };

      // Check if we are in MIDI Learn mode
      if (this.learningTarget) {
        // Create new binding
        const target = this.learningTarget;
        this.learningTarget = null;

        // Remove any prior binding for this parameter
        this.bindings = this.bindings.filter(
          (b) => !(b.targetType === target.targetType && b.trackId === target.trackId && b.param === target.param)
        );

        const newBinding: MidiBinding = {
          id: `bind_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          cc: ccNumber,
          channel,
          targetType: target.targetType,
          trackId: target.trackId,
          param: target.param,
          min: target.param === 'cutoff' ? 60 : 0,
          max: target.param === 'cutoff' ? 8000 : target.param === 'cpm' ? 250 : target.param === 'resonance' ? 24 : 1,
          label: `${target.label} (CC ${ccNumber})`,
        };

        this.bindings.push(newBinding);
        this.saveBindings();
        this.notify();
        return;
      }

      // Check existing bindings
      this.bindings.forEach((binding) => {
        if (binding.cc === ccNumber) {
          if (this.paramChangeCallback) {
            this.paramChangeCallback(binding, ccValue);
          }
        }
      });

      this.notify();
      return;
    }

    // Note On (0x9) or Note Off (0x8)
    const isNoteOn = command === 9 && d2 > 0;
    const isNoteOff = command === 8 || (command === 9 && d2 === 0);

    if (isNoteOn || isNoteOff) {
      const note = d1;
      const velocity = d2 / 127;

      this.lastActivity = {
        type: 'note',
        data: [status, d1, d2],
        text: `Note ${note} ${isNoteOn ? 'ON' : 'OFF'} vel ${d2} (ch ${channel})`,
        time: Date.now(),
      };

      if (this.liveNoteCallback) {
        this.liveNoteCallback(note, velocity, isNoteOn);
      }

      // Recording logic
      if (this.isRecording) {
        if (isNoteOn) {
          this.activeNoteOns.set(note, { note, velocity, startBeat: 0 }); // relative beat will be populated by audio clock
        } else if (isNoteOff && this.activeNoteOns.has(note)) {
          const active = this.activeNoteOns.get(note)!;
          this.recordedNotes.push({
            note: active.note,
            velocity: active.velocity,
            startBeat: active.startBeat,
            durationBeats: 0.5,
          });
          this.activeNoteOns.delete(note);
        }
      }

      this.notify();
    }
  }

  // Parse Standard MIDI File (.mid) binary buffer into a note clip
  public async parseMidiFile(file: File): Promise<MidiRecordedClip> {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Simple SMF parser: find 'MTrk' chunks and parse note-on events
    const notes: MidiRecordedClip['notes'] = [];
    let currentBeat = 0;
    let ticksPerQuarter = 480;

    // Check header 'MThd'
    if (bytes.length > 14 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64) {
      ticksPerQuarter = (bytes[12] << 8) | bytes[13];
    }

    // Scan for track chunks
    let pos = 14;
    while (pos < bytes.length - 8) {
      if (bytes[pos] === 0x4d && bytes[pos + 1] === 0x54 && bytes[pos + 2] === 0x72 && bytes[pos + 3] === 0x6b) {
        const trackLen = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
        pos += 8;
        const trackEnd = pos + trackLen;

        let trackTicks = 0;
        while (pos < trackEnd && pos < bytes.length) {
          // Read variable length delta time
          let delta = 0;
          let b = 0;
          do {
            b = bytes[pos++];
            delta = (delta << 7) | (b & 0x7f);
          } while (b & 0x80);

          trackTicks += delta;
          const beatTime = trackTicks / ticksPerQuarter;

          // Event status byte
          const status = bytes[pos++];
          if (status === 0xff) {
            // Meta event
            pos++; // type
            let len = 0;
            let mb = 0;
            do {
              mb = bytes[pos++];
              len = (len << 7) | (mb & 0x7f);
            } while (mb & 0x80);
            pos += len;
          } else if ((status >> 4) === 9) {
            // Note On
            const note = bytes[pos++];
            const vel = bytes[pos++];
            if (vel > 0) {
              notes.push({
                note,
                velocity: vel / 127,
                startBeat: beatTime,
                durationBeats: 0.5,
              });
            }
          } else if ((status >> 4) === 8) {
            pos += 2; // Note off
          } else if ((status >> 4) === 11 || (status >> 4) === 12 || (status >> 4) === 14) {
            pos += 2;
          } else if ((status >> 4) === 13) {
            pos += 1;
          }
        }
        break;
      } else {
        pos++;
      }
    }

    // Sanitize clip name
    const clipName = file.name
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');

    const durationBeats = notes.length > 0 ? Math.ceil(Math.max(...notes.map((n) => n.startBeat + n.durationBeats))) : 4;

    const clip: MidiRecordedClip = {
      id: `clip_${Date.now()}`,
      name: clipName,
      durationBeats: Math.max(4, durationBeats),
      notes: notes.slice(0, 128),
    };

    this.recordedClips.set(clipName, clip);
    this.notify();
    return clip;
  }

  private saveBindings() {
    try {
      localStorage.setItem('pulsegrid_midi_bindings', JSON.stringify(this.bindings));
    } catch {}
  }

  private loadBindings() {
    try {
      const saved = localStorage.getItem('pulsegrid_midi_bindings');
      if (saved) {
        this.bindings = JSON.parse(saved);
      }
    } catch {}
  }
}

export const midiManager = new MidiManager();
