// Unified input: keyboard + mouse for desktop, virtual stick and buttons for
// touch. Exposes an abstract state the game reads once per frame, plus a queue
// of one-shot actions so UI keys do not repeat while held.

const KEY_ACTIONS = {
  KeyE: 'enter',
  KeyF: 'fire',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyR: 'reload',
  KeyQ: 'radio',
  Tab: 'phone',
  Escape: 'pause',
  KeyM: 'map',
  KeyC: 'cheat',
  KeyH: 'help',
  KeyG: 'settings',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  Digit3: 'weapon3',
  Backquote: 'cheat',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.actions = new Set();
    this.queue = [];
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.stick = { x: 0, y: 0, active: false };
    this.touchActions = new Set();
    this.lookPointer = null;
    this.listeners = new Map();
    this.enabled = true;
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this._bindKeyboard();
    this._bindLook();
    this._bindTouch();
  }

  on(action, fn) {
    if (!this.listeners.has(action)) this.listeners.set(action, new Set());
    this.listeners.get(action).add(fn);
    return () => this.listeners.get(action)?.delete(fn);
  }

  _emit(action) {
    const set = this.listeners.get(action);
    if (set) for (const fn of set) fn();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = KEY_ACTIONS[e.code];
      if (action) {
        this.queue.push(action);
        if (action === 'jump' || action === 'phone' || action === 'cheat' || action === 'pause' || action === 'map') e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindLook() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.lookPointer || this.lookPointer.id !== e.pointerId) return;
      const dx = e.clientX - this.lookPointer.x;
      const dy = e.clientY - this.lookPointer.y;
      this.lookPointer.x = e.clientX;
      this.lookPointer.y = e.clientY;
      this.lookX += dx;
      this.lookY += dy;
    });
    const end = (e) => {
      if (this.lookPointer?.id === e.pointerId) this.lookPointer = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  _bindTouch() {
    const stickZone = document.getElementById('stick-zone');
    const knob = document.getElementById('stick-knob');
    const fire = document.getElementById('btn-fire');
    if (!stickZone || !knob) return;

    const setStick = (e) => {
      const rect = stickZone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const max = rect.width * 0.36;
      const len = Math.hypot(dx, dy);
      const k = len > max ? max / len : 1;
      const nx = dx * k;
      const ny = dy * k;
      this.stick.x = nx / max;
      this.stick.y = -ny / max;
      this.stick.active = true;
      knob.style.transform = `translate(${nx}px, ${ny}px)`;
    };
    const clear = () => {
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.active = false;
      knob.style.transform = 'translate(0,0)';
    };
    stickZone.addEventListener('pointerdown', (e) => {
      stickZone.setPointerCapture?.(e.pointerId);
      setStick(e);
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (this.stick.active) setStick(e);
    });
    stickZone.addEventListener('pointerup', clear);
    stickZone.addEventListener('pointercancel', clear);

    // Any element with data-action becomes a hold-able button.
    for (const btn of document.querySelectorAll('[data-action]')) {
      const action = btn.dataset.action;
      const press = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.touchActions.add(action);
        this.queue.push(action);
        btn.classList.add('pressed');
        if (action === 'fire') this._emit('fire-held');
      };
      const release = (e) => {
        e.preventDefault();
        this.touchActions.delete(action);
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    }

    if (fire) fire.addEventListener('pointerdown', () => { this.fireHeld = true; });
    if (fire) {
      const stop = () => { this.fireHeld = false; };
      fire.addEventListener('pointerup', stop);
      fire.addEventListener('pointercancel', stop);
      fire.addEventListener('pointerleave', stop);
    }
    document.addEventListener('touchstart', () => { this.touchMode = true; }, { once: true });
  }

  setTouchVisible(visible) {
    document.body.classList.toggle('touch', visible);
    this.touchMode = visible;
  }

  get move() {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    x += this.stick.x;
    y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  down(action) {
    if (this.touchActions.has(action)) return true;
    if (action === 'fire' && this.fireHeld) return true;
    switch (action) {
      case 'sprint': return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      case 'jump': return this.keys.has('Space');
      case 'handbrake': return this.keys.has('Space');
      case 'fire': return this.keys.has('KeyF');
      default: return false;
    }
  }

  /** One-shot actions since the last frame. */
  drain() {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  consumeLook() {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  resetStick() {
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.active = false;
    const knob = document.getElementById('stick-knob');
    if (knob) knob.style.transform = 'translate(0,0)';
  }
}
