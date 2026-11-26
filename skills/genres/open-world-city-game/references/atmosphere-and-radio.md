# Atmosphere and radio

Contents: one clock · sun, sky and fog keys · night city and emissive · weather table and wetness
· audio buses · station identity · interactive music and procedural fallback · voice and barks.

Atmosphere is the cheapest way to make a small city feel expensive. It is also where phones lose
frame time, so every effect below has a cost note.

## One clock

```js
state.clock = (state.clock + dt * settings.timeScale) % 24;   // hours, 1 real s = 1 game min
const sunAngle = ((state.clock - 6) / 12) * Math.PI;          // sunrise 06, noon 12, sunset 18
const sunDir = { x: Math.cos(sunAngle), y: Math.sin(sunAngle), z: 0.35 };
```

Pause the clock in menus, keep it running while driving, and jump it only through an explicit
action (sleep at a safehouse, cheat, mission). Weather and radio read the same clock so a rainy
3 a.m. drive sounds and looks different from noon.

## Sun, sky and fog keys

Interpolate a small table instead of scripting light rigs. Four keys cover a day:

| Hour | Sun colour | Ambient | Fog colour | Fog far | Window glow | Street lights |
|---|---|---|---|---|---|---|
| 05:30 | `#5b6b8c` | 0.25 | `#7b8aa6` | 700 | 0.35 | on |
| 08:00 | `#ffd9b0` | 0.55 | `#cfd9e6` | 950 | 0 | off |
| 12:30 | `#fff4e0` | 0.75 | `#d8e2ea` | 1100 | 0 | off |
| 18:30 | `#ff9a62` | 0.45 | `#e0a184` | 850 | 0.25 | on |
| 21:00 | `#2a3550` | 0.18 | `#131a2b` | 600 | 0.9 | on |

Two practical notes:

- Fog colour must match the skybox horizon or the streaming edge shows as a grey wall.
- `fog far` is the draw-distance lever on phones. Dropping 1100 → 700 m is usually 10-15 % GPU.
- A single directional light with a 40-70 m shadow cascade is the mobile ceiling; everything else
  is a fake: emissive windows, blob shadows under cars, a dark strip under kerbs.

## Night city

The look comes from emissive surfaces, not lights: shop signs, window grids, headlights (a cone
projector or a textured quad), neon underglow on owned vehicles, and a hemisphere light tinted by
the district palette. Budget 6-12 point lights total, pooled and assigned to the nearest hero
objects. Bloom is expensive on fill-rate-limited phones; use a cheap threshold-and-add pass at half
resolution, or bake the glow into the emissive texture.

## Weather

| State | Fog | Rain particles | Wetness target | Sky | Driving effect |
|---|---|---|---|---|---|
| clear | base | 0 | 0 | 0-0.1 cloud | none |
| rain | ×0.72 | 1,200 streaks | 0.7 | 0.55 | grip ×0.7, spray behind wheels |
| storm | ×0.55 | 2,000 + lightning | 1.0 | 0.85 | grip ×0.58, thunder, wipers |
| fog | ×0.35 | 0 | 0.15 | 0.4 grey | headlights matter |

Wetness eases toward its target at 0.08/s and feeds `grip` and road roughness: metres of road
material that go from rough 0.62 to 0.20 and gain metalness as they wet. One scalar drives
reflection, spray, tyre sound and grip — never let art and physics read different values.

Weather changes on a timer (90-240 s) with a sudden transition only for story missions. Lightning
is a full-screen white flash at 0.15 s plus a delayed thunder sample; skip the extra light.

## Audio buses

```text
Master
├── Music (radio, mission cues)         -6 dB default, ducked 8 dB on dialogue
├── SFX (engines, tyres, guns, doors)   -3 dB, 3D with distance rolloff
├── Ambience (city hum, wind, sea)      -12 dB, looping beds per district
├── UI (clicks, phone)                  -9 dB, 2D
└── Voice (barks, DJ, mission lines)    -2 dB, priority channel
```

- Engines are a looped sample pitched by rpm plus a low-pass that closes when off-throttle; boats
  and helicopters need a separate loop each.
- Tyres: filtered noise gated by slip and surface, wet squeegee on rain.
- Sirens: two-tone sample with a doppler-ish pitch shift by closing speed; cap one siren per 40 m.
- Pause the audio context on `visibilitychange`, resume on tap, and handle Android audio-focus loss.
  A radio that keeps playing in the background is a Play policy issue if it replaces a music app.

## Station identity

Each station is data: name, tagline, genre, 12-20 tracks or generated loops, 3 adverts, a DJ voice,
and a colour used by the radio wheel.

```js
const STATIONS = [
  { id: 'wave', name: 'Wave 103', tagline: 'New wave, all night', hue: '#37c7d4', bpm: 118 },
  { id: 'flash', name: 'Flash FM', tagline: 'Hits for the drive', hue: '#ff5f8f', bpm: 124 },
];
```

Rules that make it feel authored: station jingles between tracks, an advert every 4 tracks, a DJ
line on weather or time, and a "you are listening to" ident when entering a car. Keep the wheel on
a long-press so driving never pauses; remember the last station per vehicle class (boats get a
different default).

## Interactive music and procedural fallback

- Mission cues layer stems by intensity: exploration, pursuit, combat, fail. Crossfade 0.6 s.
- If there is no licensed music, synthesise: a 4-bar loop per station with a kick/snare/bass/pad
  using the platform's audio engine or WebAudio. Two oscillators and a noise burst per drum voice
  cost almost nothing and beat silence.
- Duck music under dialogue, then restore over 0.8 s; never cut it abruptly.
- Radio volume and mute live in settings and in the save file.

## Voice and barks

- Barks are 1-2 s, context-tagged (`greet`, `alarm`, `hit`, `weather`, `radio_dj`), and chosen by
  district and time of day.
- Everyone speaks in character and nobody is abusive. No slurs, no sexual harassment, no insults
  aimed at the player's identity. Write the barks in a spreadsheet with a rating column and review
  it as a content team would; this is the fastest way to fail a store review or alienate players.
- Dialogue subtitles on by default, with size and background opacity settings, and speaker names
  colour-coded without relying on colour alone.
- Localisation: keep barks in a text table with keys, never in code, so a translator can work
  without touching audio.
