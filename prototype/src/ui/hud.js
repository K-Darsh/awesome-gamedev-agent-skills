// HUD and menus. Plain DOM, no framework: panels are static markup in
// index.html and this module fills lists, binds touch/click handlers and pushes
// per-frame state into the existing elements.

import { formatClock, formatMoney } from '../sim/util.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class HUD {
  constructor(world, handlers) {
    this.world = world;
    this.handlers = handlers;
    this.panelLayer = $('#panel-layer');
    this.currentPanel = null;
    this.toastTimer = null;
    this.stationIndex = 0;
    this._cache();
    this._buildWanted();
    this._bindQuick();
    this._bindPanels();
    this._bindSettings();
    this.setTouchVisible(matchMedia('(pointer: coarse)').matches);
  }

  _cache() {
    this.cash = $('#cash');
    this.health = $('#health-fill');
    this.armor = $('#armor-fill');
    this.clock = $('#clock');
    this.weather = $('#weather');
    this.district = $('#district');
    this.missionPanel = $('#mission-panel');
    this.missionText = $('#mission-text');
    this.missionTimer = $('#mission-timer');
    this.speedo = $('#speedo');
    this.speedValue = $('#speed-value');
    this.gear = $('#gear');
    this.nitro = $('#nitro i');
    this.radioStation = $('#radio-station');
    this.radioTagline = $('#radio-tagline');
    this.crosshair = $('#crosshair');
    this.fps = $('#fps');
    this.minimapWrap = $('#minimap-wrap');
    this.subtitle = $('#subtitle');
    this.subtitleSpeaker = $('#subtitle-speaker');
    this.subtitleText = $('#subtitle-text');
    this.subtitleChoices = $('#subtitle-choices');
    this.btnEnter = $('#btn-enter');
    this.btnJump = $('#btn-jump');
    this.btnSprint = $('#btn-sprint');
    this.btnReload = $('#btn-reload');
    this.loading = $('#loading');
  }

  _buildWanted() {
    const wrap = $('#wanted');
    wrap.innerHTML = '';
    for (let i = 0; i < 5; i++) wrap.appendChild(el('span'));
    this.stars = Array.from(wrap.children);
  }

  _bindQuick() {
    for (const btn of $$('#quick [data-ui]')) {
      btn.addEventListener('click', () => {
        const ui = btn.dataset.ui;
        if (ui === 'pause') this.handlers.onPause?.();
        else this.handlers.onOpenPanel?.(ui);
      });
    }
  }

  _bindPanels() {
    for (const btn of $$('[data-do]')) {
      btn.addEventListener('click', () => {
        const action = btn.dataset.do;
        switch (action) {
          case 'start':
            this.hideIntro();
            this.handlers.onStart?.();
            break;
          case 'resume':
          case 'close':
          case 'settings-done':
            this.closePanels();
            this.handlers.onResume?.();
            break;
          case 'save':
            this.handlers.onSave?.();
            break;
          case 'settings':
            this.showPanel('settings');
            break;
          case 'help':
            this.showPanel('help');
            break;
          case 'restart':
            this.handlers.onRestart?.();
            break;
          case 'respawn':
            this.closePanels();
            this.handlers.onRespawn?.();
            break;
          default:
            break;
        }
      });
    }
    for (const tab of $$('.tab')) {
      tab.addEventListener('click', () => {
        for (const t of $$('.tab')) t.classList.toggle('active', t === tab);
        for (const body of $$('.tab-body')) body.classList.add('hidden');
        $(`#tab-${tab.dataset.tab}`)?.classList.remove('hidden');
      });
    }
    const form = $('#cheat-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#cheat-input');
      const code = input.value;
      input.value = '';
      this.handlers.onCheat?.(code);
      input.focus();
    });
  }

  _bindSettings() {
    const s = this.handlers.settings;
    const map = [
      ['set-render', 'renderScale', Number, 'out-render', (v) => `${Math.round(v * 100)}%`],
      ['set-draw', 'drawDistance', Number, 'out-draw', (v) => `${v} m`],
      ['set-sens', 'sensitivity', Number, 'out-sens', (v) => Number(v).toFixed(2)],
      ['set-stick', 'joystickSize', Number, 'out-stick', (v) => `${Math.round(v * 100)}%`],
      ['set-music', 'musicVolume', Number, 'out-music', (v) => `${Math.round(v * 100)}`],
      ['set-sfx', 'sfxVolume', Number, 'out-sfx', (v) => `${Math.round(v * 100)}`],
    ];
    for (const [id, key, cast, outId, fmt] of map) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.value = s[key];
      const out = document.getElementById(outId);
      if (out) out.textContent = fmt(s[key]);
      input.addEventListener('input', () => {
        const value = cast(input.value);
        s[key] = value;
        if (out) out.textContent = fmt(value);
        this.handlers.onSettings?.(s, key);
      });
    }
    for (const [id, key] of [['set-shadows', 'shadows'], ['set-minimap', 'minimap'], ['set-fpsview', 'showFps']]) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.checked = !!s[key];
      input.addEventListener('change', () => {
        s[key] = input.checked;
        this.handlers.onSettings?.(s, key);
      });
    }
    const quality = $('#set-quality');
    quality.value = s.quality ?? 'auto';
    quality.addEventListener('change', () => {
      s.quality = quality.value;
      this.handlers.onSettings?.(s, 'quality');
    });
    const fps = $('#set-fps');
    fps.value = String(s.fpsCap ?? 60);
    fps.addEventListener('change', () => {
      s.fpsCap = Number(fps.value);
      this.handlers.onSettings?.(s, 'fpsCap');
    });
    const touch = $('#set-touch');
    touch.checked = document.body.classList.contains('touch');
    touch.addEventListener('change', () => this.setTouchVisible(touch.checked));
  }

  setTouchVisible(visible) {
    document.body.classList.toggle('touch', visible);
    this.handlers.onTouchToggle?.(visible);
  }

  syncSettings() {
    const s = this.handlers.settings;
    const set = (id, value) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    };
    set('set-render', s.renderScale);
    set('set-draw', s.drawDistance);
    set('set-fps', String(s.fpsCap));
    set('set-sens', s.sensitivity);
    set('set-stick', s.joystickSize);
    set('set-music', s.musicVolume);
    set('set-sfx', s.sfxVolume);
    const out = (id, text) => {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    };
    out('out-render', `${Math.round(s.renderScale * 100)}%`);
    out('out-draw', `${s.drawDistance} m`);
    out('out-sens', Number(s.sensitivity).toFixed(2));
    out('out-stick', `${Math.round(s.joystickSize * 100)}%`);
    out('out-music', `${Math.round(s.musicVolume * 100)}`);
    out('out-sfx', `${Math.round(s.sfxVolume * 100)}`);
    document.getElementById('set-shadows').checked = s.shadows;
    document.getElementById('set-minimap').checked = s.minimap;
    document.getElementById('set-fpsview').checked = s.showFps;
    document.getElementById('set-quality').value = s.quality ?? 'auto';
    document.documentElement.style.setProperty('--stick-scale', String(s.joystickSize));
  }

  hideIntro() {
    this.panelLayer.classList.add('hidden');
    this.currentPanel = null;
  }

  showPanel(name) {
    this.currentPanel = name;
    this.panelLayer.classList.remove('hidden');
    for (const panel of $$('.panel-wrap')) panel.classList.add('hidden');
    const target = document.getElementById(`panel-${name}`);
    if (target) {
      target.classList.remove('hidden');
      target.scrollTop = 0;
    }
    if (name === 'cheats') {
      this.renderCheatSuggestions();
      setTimeout(() => document.getElementById('cheat-input')?.focus(), 60);
    }
    if (name === 'settings') this.syncSettings();
  }

  closePanels() {
    if (this.currentPanel === 'intro') return;
    this.panelLayer.classList.add('hidden');
    for (const panel of $$('.panel-wrap')) panel.classList.add('hidden');
    this.currentPanel = null;
  }

  get panelOpen() {
    return !this.panelLayer.classList.contains('hidden');
  }

  setLoading(pct, text) {
    const fill = document.getElementById('loading-fill');
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
    const label = document.getElementById('loading-text');
    if (label && text) label.textContent = text;
  }

  hideLoading() {
    this.loading.classList.add('done');
    setTimeout(() => this.loading.classList.add('hidden'), 500);
  }

  toast(text, kind = '', ms = 3200) {
    const wrap = $('#toasts');
    const node = el('div', `toast ${kind}`, text);
    wrap.appendChild(node);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity 0.3s';
      setTimeout(() => node.remove(), 320);
    }, ms);
  }

  mission(text, timer = '', cls = '') {
    if (!text) {
      this.missionPanel.classList.add('hidden');
      return;
    }
    this.missionPanel.classList.remove('hidden');
    this.missionPanel.classList.remove('ok', 'fail');
    if (cls) this.missionPanel.classList.add(cls);
    this.missionText.textContent = text;
    this.missionTimer.textContent = timer;
  }

  dialogue(speaker, text, choices = []) {
    this.subtitle.classList.remove('hidden');
    this.subtitleSpeaker.textContent = speaker ?? '';
    this.subtitleText.textContent = text ?? '';
    this.subtitleChoices.innerHTML = '';
    for (const choice of choices) {
      const btn = el('button', 'primary', choice.label);
      btn.addEventListener('click', () => {
        this.hideDialogue();
        this.handlers.onChoice?.(choice.id);
      });
      this.subtitleChoices.appendChild(btn);
    }
    if (!choices.length) {
      const btn = el('button', '', 'Continue');
      btn.addEventListener('click', () => this.hideDialogue());
      this.subtitleChoices.appendChild(btn);
    }
    clearTimeout(this._dlgTimer);
    if (!choices.length) this._dlgTimer = setTimeout(() => this.hideDialogue(), 7000);
  }

  hideDialogue() {
    this.subtitle.classList.add('hidden');
    this.subtitleChoices.innerHTML = '';
  }

  update(state) {
    this.cash.textContent = formatMoney(state.cash ?? 0);
    this.health.style.width = `${Math.max(0, Math.min(100, state.health ?? 0))}%`;
    this.armor.style.width = `${Math.max(0, Math.min(100, state.armor ?? 0))}%`;
    this.stars.forEach((star, i) => star.classList.toggle('on', i < (state.wanted ?? 0)));
    this.clock.textContent = formatClock(state.clock ?? 12);
    this.weather.textContent = (state.weather ?? 'clear').toUpperCase();
    this.district.textContent = (state.district ?? '').toUpperCase();
    this.fps.textContent = `${Math.round(state.fps ?? 0)} fps · ${state.drawCalls ?? 0} calls`;
    this.fps.classList.toggle('hidden', !this.handlers.settings.showFps);
    this.minimapWrap.classList.toggle('hidden', !this.handlers.settings.minimap);
    this.speedo.classList.toggle('hidden', !state.inVehicle);
    if (state.inVehicle) {
      this.speedValue.textContent = String(Math.round(state.speed ?? 0));
      this.gear.textContent = state.reverse ? 'R' : state.airborne ? 'FLY' : 'D';
      this.nitro.style.width = `${Math.max(0, Math.min(100, state.nitro ?? 0))}%`;
    }
    this.radioStation.textContent = state.stationName ?? 'Radio Off';
    this.radioTagline.textContent = state.stationTagline ?? '';
    this.crosshair.classList.toggle('hidden', !!state.inVehicle);
    this.btnEnter.textContent = state.inVehicle ? 'EXIT' : state.canEnter ? 'ENTER' : 'ENTER';
    this.btnJump.textContent = state.inVehicle ? 'BRAKE' : 'JUMP';
    this.btnSprint.textContent = state.inVehicle ? 'NOS' : 'RUN';
    this.btnReload.textContent = state.inVehicle ? 'RADIO' : 'LOAD';
    if (state.weapon) {
      this.crosshair.title = `${state.weapon} ${state.ammo ?? ''}`;
    }
  }

  renderStations(stations, activeIndex, onSelect) {
    const list = $('#station-list');
    list.innerHTML = '';
    stations.forEach((station, i) => {
      const btn = el('button', `station ${i === activeIndex ? 'active' : ''}`);
      const left = el('div');
      left.appendChild(el('b', '', station.name));
      left.appendChild(el('small', '', station.tagline));
      btn.appendChild(left);
      btn.appendChild(el('span', 'tag', i === activeIndex ? 'ON AIR' : 'TUNE'));
      btn.addEventListener('click', () => {
        this.stationIndex = i;
        this.renderStations(stations, i, onSelect);
        onSelect(i);
      });
      list.appendChild(btn);
    });
  }

  renderCheatSuggestions() {
    const wrap = $('#cheat-suggestions');
    if (wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    const suggestions = ['ASPIRINE', 'LEAVEMEALONE', 'COMETOYSIDE', 'AIRSHIP', 'STORMY', 'FULLCLIP'];
    for (const code of suggestions) {
      const btn = el('button', '', code);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const input = $('#cheat-input');
        input.value = code;
        input.focus();
      });
      wrap.appendChild(btn);
    }
  }

  cheatResult(text, ok) {
    const node = $('#cheat-result');
    node.textContent = text;
    node.style.color = ok ? 'var(--green)' : 'var(--red)';
  }

  renderJobs(offers, active, onStart) {
    const body = $('#tab-jobs');
    body.innerHTML = '';
    if (active) {
      const card = el('div', 'card');
      card.appendChild(el('h3', '', active.title));
      card.appendChild(el('p', '', active.blurb ?? ''));
      card.appendChild(el('div', 'meta', `In progress · ${active.contact}`));
      body.appendChild(card);
    }
    if (!offers.length) {
      body.appendChild(el('p', 'fineprint', 'No jobs on offer. Finish what you started or buy a business.'));
      return;
    }
    for (const mission of offers) {
      const card = el('div', 'card');
      card.appendChild(el('h3', '', `${mission.title}`));
      card.appendChild(el('div', 'meta', `${mission.contact} · ${formatMoney(mission.pay)}`));
      card.appendChild(el('p', '', mission.blurb));
      const actions = el('div', 'actions');
      const btn = el('button', 'primary', mission.finale ? 'Take the job (choose a route)' : 'Start job');
      btn.addEventListener('click', () => onStart(mission.id));
      actions.appendChild(btn);
      card.appendChild(actions);
      body.appendChild(card);
    }
  }

  renderProperty(properties, ownedIds, cash, handlers) {
    const body = $('#tab-property');
    body.innerHTML = '';
    for (const prop of properties) {
      const owned = ownedIds.has(prop.id);
      const card = el('div', 'card');
      card.appendChild(el('h3', '', prop.name));
      const meta = el('div', 'meta');
      meta.appendChild(el('span', '', `${prop.kind.toUpperCase()} · ${formatMoney(prop.price)}`));
      if (owned && prop.income) meta.appendChild(el('span', '', `+${formatMoney(prop.income)}/day`));
      card.appendChild(meta);
      card.appendChild(el('p', '', prop.blurb));
      const actions = el('div', 'actions');
      if (!owned) {
        const buy = el('button', 'primary', `Buy · ${formatMoney(prop.price)}`);
        buy.disabled = cash < prop.price;
        buy.addEventListener('click', () => handlers.onBuy(prop.id));
        actions.appendChild(buy);
      } else {
        const income = el('button', '', 'Collect income');
        income.addEventListener('click', () => handlers.onCollect(prop.id));
        actions.appendChild(income);
        const save = el('button', '', 'Save here');
        save.addEventListener('click', () => handlers.onSave(prop.id));
        actions.appendChild(save);
        if (['garage', 'workshop', 'clothes', 'resort', 'hotel'].includes(prop.kind)) {
          const shop = el('button', '', prop.kind === 'garage' ? 'Customise' : prop.kind === 'workshop' ? 'Craft' : 'Wardrobe');
          shop.addEventListener('click', () => handlers.onShop(prop.id));
          actions.appendChild(shop);
        }
      }
      card.appendChild(actions);
      body.appendChild(card);
    }
  }

  renderGarage(garage, handlers) {
    const body = $('#tab-garage');
    body.innerHTML = '';
    if (!garage.length) {
      body.appendChild(el('p', 'fineprint', 'No stored vehicles yet. Drive one to a garage you own and press store.'));
      return;
    }
    garage.forEach((car, index) => {
      const card = el('div', 'card');
      card.appendChild(el('h3', '', `${car.type}`));
      card.appendChild(el('div', 'meta', `${car.upgrades?.length ?? 0} upgrades · condition ${Math.round(car.health)}%`));
      const actions = el('div', 'actions');
      const spawn = el('button', 'primary', 'Bring out');
      spawn.addEventListener('click', () => handlers.onSpawnStored(index));
      actions.appendChild(spawn);
      card.appendChild(actions);
      body.appendChild(card);
    });
  }

  renderShop({ title, sub, rows }) {
    $('#shop-title').textContent = title;
    $('#shop-sub').textContent = sub ?? '';
    const body = $('#shop-body');
    body.innerHTML = '';
    for (const row of rows) {
      const card = el('div', 'card');
      const flex = el('div', 'shop-row');
      const left = el('div');
      left.appendChild(el('h3', '', row.label));
      left.appendChild(el('small', '', row.sub ?? ''));
      flex.appendChild(left);
      const btn = el('button', row.primary ? 'primary' : '', row.actionLabel);
      btn.disabled = !!row.disabled;
      btn.addEventListener('click', () => row.onAction?.());
      flex.appendChild(btn);
      card.appendChild(flex);
      body.appendChild(card);
    }
    if (!rows.length) body.appendChild(el('p', 'fineprint', 'Nothing available here yet.'));
    this.showPanel('shop');
  }

  showDeath(text) {
    $('#death-text').textContent = text;
    this.showPanel('death');
  }
}
