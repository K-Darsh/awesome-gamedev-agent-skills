// Procedural radio and SFX. There are no audio files in the repository: every
// station is synthesised with WebAudio so the repository stays license-clean and
// the soundtrack reacts to speed, weather and heat.
// Swap `_scheduleBar` for streamed music in production; the interfaces stay.

export const STATIONS = [
  { id: 'neon88', name: 'Neon 88', tagline: 'synthwave · all night long', bpm: 104, root: 45, style: 'synthwave', prog: [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]], host: 'Delia' },
  { id: 'wave103', name: 'Wave 103', tagline: 'new wave · neon hits', bpm: 118, root: 48, style: 'newwave', prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], host: 'Rick' },
  { id: 'coast', name: 'Coast FM', tagline: 'freestyle · beach drive', bpm: 112, root: 50, style: 'freestyle', prog: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [-2, 2, 5]], host: 'Nikki' },
  { id: 'harbor', name: 'Harbour Radio', tagline: 'latin chill · sunset sessions', bpm: 92, root: 43, style: 'latin', prog: [[0, 4, 7], [-5, 0, 4], [-7, -3, 0], [2, 5, 9]], host: 'Paco' },
  { id: 'off', name: 'Radio Off', tagline: 'just the engine', bpm: 0, root: 0, style: 'off', prog: [], host: '' },
];

const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stationIndex = 0;
    this.musicVolume = 0.55;
    this.sfxVolume = 0.8;
    this.intensity = 0;
    this.started = false;
    this.schedulerId = null;
    this.nextNoteTime = 0;
    this.step = 0;
    this.bar = 0;
    this.rng = makeRng(1986);
    this.lastSfx = new Map();
  }

  get station() {
    return STATIONS[this.stationIndex];
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (pointer/key) on mobile browsers. */
  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this._buildGraph();
      this._startEngineSound();
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.schedulerId = setInterval(() => this._scheduler(), 25);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.started = this.ready;
    if (this.started) this._announce();
    return this.started;
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.musicFilter.Q.value = 0.6;
    this.musicBus.connect(this.musicFilter);
    this.musicFilter.connect(this.master);

    // Cheap plate-ish delay for the arp.
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.28;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.32;
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.delay.connect(wet);
    wet.connect(this.musicFilter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  _startEngineSound() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 30;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);
    this.engineOsc.start();
    this.engineSub.start();

    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'square';
    this.sirenOsc.frequency.value = 880;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sfxBus);
    this.sirenOsc.start();
  }

  _announce() {
    this.playSfx('radio_on');
  }

  setStation(index) {
    this.stationIndex = ((index % STATIONS.length) + STATIONS.length) % STATIONS.length;
    this.step = 0;
    this.bar = 0;
    this.rng = makeRng(1986 + this.stationIndex * 77);
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.06;
    if (this.ready) this.playSfx('ui_click');
    return this.station;
  }

  nextStation() {
    return this.setStation(this.stationIndex + 1);
  }

  setVolumes(music, sfx) {
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.sfxVolume = Math.max(0, Math.min(1, sfx));
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume;
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume;
  }

  update(dt, state) {
    if (!this.ctx) return;
    const speed = Math.abs(state.speed ?? 0);
    const inVehicle = !!state.inVehicle;
    const target = inVehicle ? Math.min(0.14, 0.02 + speed / 260) : 0;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
    if (inVehicle) {
      const freq = 48 + speed * 2.4;
      this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.08);
      this.engineSub.frequency.setTargetAtTime(freq * 0.5, this.ctx.currentTime, 0.08);
      this.engineFilter.frequency.setTargetAtTime(300 + speed * 22, this.ctx.currentTime, 0.1);
    }
    const sirenOn = (state.wanted ?? 0) >= 2;
    this.sirenGain.gain.setTargetAtTime(sirenOn ? 0.035 : 0, this.ctx.currentTime, 0.25);
    if (sirenOn) {
      const t = this.ctx.currentTime;
      this.sirenOsc.frequency.setTargetAtTime(720 + ((Math.sin(t * 3.4) + 1) / 2) * 520, t, 0.05);
    }
    // Chase music opens the filter and adds percussion; cruising keeps it warm.
    const heat = Math.min(1, (state.wanted ?? 0) / 3);
    this.intensity = Math.max(state.intensity ?? 0, heat);
    if (this.musicFilter) {
      this.musicFilter.frequency.setTargetAtTime(1500 + speed * 12 + this.intensity * 2600, this.ctx.currentTime, 0.4);
    }
  }

  _scheduler() {
    if (!this.ctx || !this.ready) return;
    const station = this.station;
    if (station.style === 'off') {
      this.nextNoteTime = this.ctx.currentTime + 0.25;
      return;
    }
    const stepDur = 60 / station.bpm / 4;
    while (this.nextNoteTime < this.ctx.currentTime + 0.22) {
      this._scheduleStep(this.step, this.nextNoteTime, station, stepDur);
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
      this.nextNoteTime += stepDur;
    }
  }

  _scheduleStep(step, when, station, stepDur) {
    const chord = station.prog[this.bar % station.prog.length] ?? station.prog[0] ?? [0, 4, 7];
    const root = station.root;
    const beat = step % 4 === 0;
    const half = step % 8 === 0;
    const rng = this.rng;

    // Drums
    if (beat) this._kick(when, 0.9);
    if (step === 4 || step === 12) this._snare(when, 0.55);
    if (station.style === 'freestyle' && (step === 7 || step === 15)) this._snare(when, 0.3);
    if (station.style !== 'latin' && step % 2 === 0) this._hat(when, 0.16 + (this.intensity * 0.1));
    if (station.style === 'latin' && step % 4 === 2) this._hat(when, 0.2);

    // Bass: root on the downbeat, octave bounce on the offbeat
    if (beat || (station.style === 'freestyle' && step === 6)) {
      const note = root - 12 + (step === 8 ? 12 : 0);
      this._bass(when, NOTE(note), stepDur * 1.8, 0.22);
    }

    // Arpeggio
    const arpOn = station.style === 'latin' ? step % 2 === 0 : true;
    if (arpOn) {
      const idx = step % chord.length;
      const octave = (Math.floor(step / chord.length) % 2) * 12;
      const note = root + 12 + chord[idx] + octave;
      this._pluck(when, NOTE(note), stepDur * 0.9, 0.09 + this.intensity * 0.03, station.style === 'newwave' ? 'square' : 'sawtooth');
    }

    // Pad at the top of each bar
    if (step === 0) {
      for (const interval of chord) this._pad(when, NOTE(root + interval), (60 / station.bpm) * 4, 0.03, station.style === 'latin' ? 'triangle' : 'sawtooth');
    }
    if (rng() < 0.02 && this.intensity > 0.4) this._pluck(when + stepDur * 0.5, NOTE(root + 24 + chord[1]), stepDur, 0.05, 'square');
  }

  _env(node, when, attack, hold, release, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(peak, when + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.6), when + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, when + attack + hold + release);
  }

  _kick(when, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(44, when + 0.18);
    this._env(g, when, 0.004, 0.02, 0.28, gain);
    osc.connect(g).connect(this.musicBus);
    osc.start(when);
    osc.stop(when + 0.36);
  }

  _snare(when, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    this._env(g, when, 0.002, 0.01, 0.16, gain);
    src.connect(bp).connect(g).connect(this.musicBus);
    src.start(when);
    src.stop(when + 0.2);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(190, when);
    const bg = ctx.createGain();
    this._env(bg, when, 0.002, 0.01, 0.1, gain * 0.4);
    body.connect(bg).connect(this.musicBus);
    body.start(when);
    body.stop(when + 0.16);
  }

  _hat(when, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    this._env(g, when, 0.001, 0.004, 0.045, gain);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(when);
    src.stop(when + 0.08);
  }

  _bass(when, freq, dur, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 3;
    const g = ctx.createGain();
    this._env(g, when, 0.008, dur * 0.5, dur * 0.5, gain);
    osc.connect(filter).connect(g).connect(this.musicBus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  _pluck(when, freq, dur, gain, type = 'sawtooth') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, when);
    filter.frequency.exponentialRampToValueAtTime(900, when + dur * 1.4);
    filter.Q.value = 6;
    const g = ctx.createGain();
    this._env(g, when, 0.005, dur * 0.35, dur, gain);
    osc.connect(filter).connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay);
    osc.start(when);
    osc.stop(when + dur * 2 + 0.05);
  }

  _pad(when, freq, dur, gain, type) {
    const ctx = this.ctx;
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(gain, when + 0.4);
      g.gain.linearRampToValueAtTime(0.0001, when + dur);
      osc.connect(filter).connect(g).connect(this.musicBus);
      osc.start(when);
      osc.stop(when + dur + 0.1);
    }
  }

  /** One-shot effects. Opened for the game's event bus. */
  playSfx(name, opts = {}) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const last = this.lastSfx.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastSfx.set(name, now);
    switch (name) {
      case 'gunshot': return this._noiseBurst(now, 0.32, 1600, 0.16, 0.05);
      case 'suppressed': return this._noiseBurst(now, 0.14, 900, 0.05, 0.02);
      case 'explosion': return this._noiseBurst(now, 1.1, 320, 0.5, 0.7);
      case 'crash': return this._noiseBurst(now, 0.35, 700, 0.2, 0.2);
      case 'reload': return this._blip(now, 420, 0.06, 0.06, 'square');
      case 'empty': return this._blip(now, 180, 0.05, 0.05, 'square');
      case 'pickup': return this._arp(now, [72, 76, 79], 0.06, 0.09);
      case 'health': return this._arp(now, [67, 72, 76], 0.07, 0.1);
      case 'money': return this._arp(now, [76, 80, 84, 88], 0.05, 0.08);
      case 'horn': return this._blip(now, 330, 0.3, 0.07, 'sawtooth');
      case 'ui_click': return this._blip(now, 840, 0.03, 0.05, 'triangle');
      case 'ui_back': return this._blip(now, 420, 0.05, 0.05, 'triangle');
      case 'radio_on': return this._arp(now, [64, 71, 76], 0.08, 0.05);
      case 'success': return this._arp(now, [65, 69, 72, 77], 0.12, 0.12);
      case 'fail': return this._arp(now, [60, 56, 52], 0.18, 0.1);
      case 'wanted': return this._arp(now, [72, 75, 79], 0.08, 0.08);
      case 'save': return this._arp(now, [72, 79], 0.12, 0.08);
      case 'engine_crash': return this._noiseBurst(now, 0.5, 420, 0.3, 0.4);
      case 'thunder': return this._noiseBurst(now, 1.4, 180, 0.55, 1.2);
      default: return undefined;
    }
  }

  _blip(when, freq, dur, gain, type) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, when, 0.004, dur * 0.4, dur, gain);
    osc.connect(g).connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  _arp(when, notes, step, gain) {
    notes.forEach((midi, i) => this._blip(when + i * step, NOTE(midi), step * 1.4, gain, 'triangle'));
  }

  _noiseBurst(when, dur, cutoff, gain, decay) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.18), when + decay);
    const g = ctx.createGain();
    this._env(g, when, 0.004, dur * 0.2, Math.max(0.06, decay), gain);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(when);
    src.stop(when + dur + decay + 0.1);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend();
    return Promise.resolve();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }
}
