# Touch UI and cheats

Contents: thumb zones and layouts · control inventory per mode · sizing and safe areas
· camera and look rules · HUD minimums · the cheat console · code table and parser · accessibility.

A city game lives or dies on its controls: two thumbs drive a car, aim a pistol, steer a boat and
fly a helicopter. Design the layout before the HUD art, and test with a 6-inch phone in each hand.

## Thumb zones

```text
┌──────────────────────────────────────────────┐
│  status: cash · stars · clock · weather      │  top 12 %, not tappable
│  minimap top-right, 180 px, rounded          │
│                                              │
│  [pause]                                     │
│                                              │
│  ┌────────────┐                ┌───────────┐ │
│  │ virtual    │                │  action   │ │  bottom 40 % reachable
│  │ stick      │                │  cluster  │ │
│  └────────────┘                └───────────┘ │
└──────────────────────────────────────────────┘
```

- Stick radius 64-72 dp, thumb anchored to the lower-left quadrant; the stick appears where the
  thumb lands inside the quadrant and recentres if the finger drags past 90 dp.
- Right cluster: 3-5 round buttons of 44-56 dp, 8 dp apart, within 60° of the bottom-right corner.
  More than five requires a second layer or a wheel.
- Empty centre so the view is not blocked; nothing interactive in the top 100 dp except the pause
  button, which respects the notch.
- Safe areas: inset all HUD by `env(safe-area-inset-*)` on web, by display cutout insets on Android.
  A minimap under a camera punch-hole is a shipping bug.

## Control inventory

| Mode | Left thumb | Right thumb | Contextual |
|---|---|---|---|
| On foot | move stick | drag to look, fire, jump, enter | use/enter prompt, weapon swap |
| Driving | steer + throttle/brake pad | drag to look, handbrake, horn, radio | nitro when owned |
| Flight | collective (up/down) + yaw | pitch/roll, camera | land, gear for planes |
| Boat | steer + throttle | look, horn | anchor |
| Aiming | move | drag to aim, fire, reload | weapon wheel on hold |

Use one action map with named actions (`fire`, `handbrake`, `radio`, `enter`) so a keyboard, a
gamepad and the touch layer bind the same names. Buffer presses for 120 ms; a missed "enter"
because the player was mid-animation feels broken.

## Sizing and feedback

- 44 pt minimum target, 48 pt for anything used while driving.
- Every button needs a pressed state within one frame and a 30 ms haptic tick (optional, off by
  default).
- No hover-only affordance; no tiny drag handles. A weapon or radio wheel opens on long-press
  (250 ms) and selects on release, with a deadzone in the centre so a tap cancels.
- Drag-to-look uses pointer capture and a sensitivity setting in cm/360°, not pixels, so it behaves
  the same across densities.

## Camera

- Chase camera behind the car, height 3.2 m, distance `6.5 + speed · 0.045`, with a look-ahead of
  0.35 s and a 2 s re-centre after a manual drag.
- On foot: over-the-shoulder at 2.6 m, 1.55 m height, camera collision against buildings with a
  0.3 m skin.
- Aiming pulls the camera to 1.9 m and narrows FOV by 8°; release returns over 0.25 s.
- Flight: a wider offset and a horizon-locked roll reference, or players lose the ground.
- Never rotate the camera through a wall; sweep from the pivot to the desired position and stop at
  the first hit.

## HUD minimums

Cash, wanted stars, clock, and a health/armour bar. The minimap shows roads, water, the player
arrow, pickups (health, armour), owned properties, the active waypoint and the mission marker.
Everything else is optional and off by default. Keep the minimap at 130 m range for driving and
expand to 220 m for aircraft.

## The cheat console

Nostalgia is a feature, but a phone has no keyboard shortcut. Put the console in the pause menu as
a field labelled "Enter code", and accept typed codes on desktop builds too.

```js
const CODES = new Map([
  ['aspirine',        { effect: 'health' }],
  ['leavemealone',    { effect: 'clearWanted' }],
  ['panzer',          { effect: 'spawn', type: 'supercar', armoured: true }],
  ['seaways',         { effect: 'spawn', type: 'boat', water: true }],
  ['bigbang',         { effect: 'explode' }],
  ['night',           { effect: 'time', hour: 22 }],
  ['catsanddogs',     { effect: 'weather', state: 'rain' }],
  ['youwonttakeme',   { effect: 'wanted', stars: 6 }],
  ['fullclips',       { effect: 'ammo', amount: 200 }],
  ['fixit',           { effect: 'repair' }],
  ['moneytalks',      { effect: 'cash', amount: 250000 }],
]);

const normalise = (raw) => raw.toLowerCase().replace(/[^a-z0-9]/g, '');
```

Rules:

- Normalise before matching (case, spaces, punctuation), and accept an on-screen keyboard layout
  with a submit key.
- Applying a code shows a toast, saves nothing by itself, and never charges the player.
- Cheat use may flag the save as `cheated` so achievements and leaderboards stay honest; tell the
  player once, in one line, without a modal.
- Keep the codes in data, with a short description, so the console can autocomplete in a "codes
  found" list after the player discovers them in the world.

## Accessibility

- Remappable touch layout: buttons can be dragged and scaled, with a reset.
- Invert Y, sensitivity sliders, left-handed mirror, colour-blind palettes for wanted stars and
  mission markers, subtitle size and background.
- Auto-accelerate option for driving (hold-to-go is painful over 20 minutes).
- No colour-only signals: wanted stars also change count and shape; health also drops in number.
- Text at 1.25× and 1.5× scale must not clip HUD chips; test the German string lengths.
