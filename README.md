# GDD — “Echoes of the Ruin”

*(2.5D pixel-art action platformer for the web, built with Babylon.js; one punishing difficulty; no casual modes)*

---

## 1) High-Concept

**USP / Fantasy.** A tightly-scoped, browser-playable souls-like with readable 2D combat and atmospheric 3D presentation (parallax, lights, post-FX). Mastery is earned by learning strict telegraphs and punish windows.

**Inspirations.** Hollow Knight (readability), Dead Cells (input feel), Blasphemous (tone), classic Souls (risk/reward, shrines, optional duel).

**Play cadence.**

* *Micro loop:* explore → scout tells → commit → punish or get punished → shrine recover.
* *Session loop:* push to next shrine → boss wall → skill gain → repeat.
* *Run loop:* 2–3 hours for first clear; subsequent clears \~60–90 minutes.

**Constraints.** Pixel art; \~64 MB texture budget; 60 FPS on mid-range laptops; no online features.

---

## 2) Design Pillars

1. **Readable, lethal combat.**

   * *Checks:* every attack has a unique pose/sfx; punish windows ≥ 12f; no “surprise” off-screen hits; screen never more than one full-screen burst at once.

2. **Atmosphere > exposition.**

   * *Checks:* no cutscenes longer than 8 s; 90% lore environmental; optional lore items.

3. **Lean progression.**

   * *Checks:* ≤ 3 upgrade lines; ≤ 3 relics in v1; no crafting, no loot tables.

4. **Cohesive art/sound.**

   * *Checks:* palette ties (muted mid-tones + cold highlights), common outline rules, shared reverb, unified hit FX.

5. **Web-first performance.**

   * *Checks:* ≤ 300 draw calls, ≤ 100 active sprites, ≤ 10 particle systems; single texture upload per family.

---

## 3) Narrative & World (Expanded)

**The Oath.** “Return the Crown, or be Taken.” The King cheated death by binding a crown in the monastery. Death sent an angel to collect, birthing a stalemate. Knights were sent; most fell.

**Acts & Biomes.**

1. **Lost Glades (Tutorial)** — Shrine awaken; learn movement, roll, timing strikes on single wolf; anti-air on bat.
2. **Act I: Dusk Wood** — Wolf territory; white **Pack-Leader** seals the forest.
3. **Act II: Castle Prison → Blood Mansion** — Bats swarm; **Skeleton Warriors** guard cells; **Fallen Knight** lurks behind a hidden, keyed door; **Skeleton King** rules the mansion.
4. **Act III: Deadwind Pass → Forgotten Cemetery** — Spectral variants and **Ghost Warriors** lead to the **Angel of Death**.

**Optional lore beats.**

* Stone idols show knights handing a crown to monks.
* Prison wall etchings (“We bled, the crown did not”).
* Fallen Knight’s chamber: broken vows; his sword embedded in a shrine pedestal.
* Final arena mosaics: faithful vs. oathbreakers.

**Endings.**

* *Absolution:* return the crown; Angel departs; NG+ hook (harder teleports, new relic).
* *Taken:* refuse; Angel marks you; NG+ starts with debuff relic but stronger Blade tree.

---

## 4) Core Gameplay (Deep Detail)

### Input, Physics & Camera

* **Polling:** render-driven with engine.getDeltaTime(); clamp dt to a max of 1/30s; optional fixed-step (60 Hz) toggle later for deterministic combat tests; input buffer 120 ms; coyote 120 ms.
* **Gravity:** 52 px/s²; terminal v ≈ 620 px/s; jump impulse tuned for 4 tiles.
* **Friction:** ground decel 900 px/s²; air control 60%.
* **Camera:** orthographic FreeCamera; dead-zone 48×32 px; predictive 24 px toward input; screen shake capped to 6 px @ 60 ms with ease-out; clamp to level bounds.

### Hurtboxes / Hitboxes

* **Scale:** hero hurtbox \~20×44 px; expanded 10% while rolling ends (vulnerability).
* **Hitstop:** 60–100 ms on landed hits (longer on charged heavy).
* **I-frames:** roll frames 6–18; flask roll-cancel available after 0.5 s.

### Offense, Defense & Cancel Rules

* **Light chain:** 3 attacks; L1→L2, L2→L3 cancel windows start on active+6f; L3 cancels only to roll.
* **Heavy/Charge:** hold 0.4–0.8 s; adds +12 dmg; can feint cancel back to neutral up to 0.25 s.
* **Deflection:** precise rolls reduce incoming chip to zero and add 10 stamina on successful avoid.

### Resource Economy

* **Oath Flasks:** 3→4 after Skeleton King; 55% heal; 0.9 s drink; cancel to roll after 0.5 s (consumes flask).
* **Ash Fragments:** +1 per standard encounter, +5 elite, +20 boss; first Shrine unlock at 10, next at 25, final at 45.
* **Keys/Seals:**

  * **Crypt Key** (Castle Prison): held by *Jailor* (Axe Skeleton variant) behind a timed portcullis challenge.
  * **Throne Seal** (Skeleton King drop) gates the monastery.
  * **Oculus Key** (pre-placed in Deadwind Pass alcove) opens final nave.

### Upgrades (exact effects)

* **Blade**

  1. +10% light and heavy damage.
  2. Charged heavy grants an additional damage bonus on hit.
  3. Unlock **Charged Follow-up** (quick lunge, 20 dmg, −14 stamina).
* **Guard**

  1. +10% stamina regeneration.
  2. Perfect rolls restore **8 stamina** on success.
  3. **Riposte Flow:** first light after a perfect roll deals ×1.2 and refreshes 5 stamina.
* **Vow**

  1. +1 flask capacity or +12% flask efficiency (choose once).
  2. −20% sanity VFX strength in cursed zones.
  3. **Shrine Breeze:** leaving a shrine grants 5 s +10% stamina regen.

### Relics (v1)

* **Broken Vow** (Fallen Knight): extends perfect-roll window by +20 ms.
* **Howl Fragment** (White Wolf): stamina regen +10% when ≥2 enemies are aggro.
* **Halo Chip** (Angel NG+): enables perfect-roll tiny shockwave (cosmetic in v1).

---

## 5) Biomes & Level Design (Concrete Metrics)

**Global tiles:** 16×16 px.
**Room spans:** 22–40 tiles wide, 12–22 tiles high.
**Checkpoint pacing:** every 2–4 rooms; before boss doors.
**Secrets:** ≤ 1 per biome (breakable wall, false floor, or lever chain).

### Lost Glades

* **Rooms:** 3 compact; 1 shrine.
* **Teachings:** jump, roll through wolf lunge, spacing prompts once; anti-air bat.

### Dusk Wood

* **Rooms:** 6; 1 shrine mid; 1 wolf-pack arena (3 wolves simultaneously).
* **Hazards:** collapsing logs (respawn on death), shallow water (slows 20%).
* **Elite:** **White Wolf** arena: circular glade, 2 destructible trunks.

### Castle Prison

* **Rooms:** 6; 1 shrine; timed portcullis (5 s window), spike floors, lifts.
* **Key puzzle:** ring 3 bells (timer resets if you fail) → opens “Jailor” cell → **Crypt Key** drop.
* **Enemies:** bat clusters (4–5 on ceiling), Skeleton Warriors patrols.

### Blood Mansion

* **Rooms:** 1–2 before boss; drop-able chandeliers (rope cut or projectile trick); rare turret statue (slow bolt).
* **Boss:** **Skeleton King**.

### Deadwind Pass

* **Rooms:** 5; 1 shrine; wind zones (push ±15% horizontal; jump arcs altered); bone outcrops & narrow ledges.
* **Enemies:** spectral wolves (blue/purple post-FX), Ghost Warriors, vampire bats.
* **Oculus Key** tucked on a wind-assisted platforming branch.

### Forgotten Cemetery

* **Rooms:** 2; collapsing graves; sanctified torches (light cones reduce sanity VFX).
* **Boss:** **Angel of Death**.

**Parallax/lighting per biome** listed in §10.

---

## 6) Enemy Roster (AI & Telegraphs)

**Common settings**

* **Sight cone:** 120°; detection 8 tiles (wolves), 10 (skeleton/ghost), 12 (bats from ceiling).
* **Leash:** 14–18 tiles; reset to idle after 3 s without line of sight.
* **On stagger:** cancel current attack; recovery 0.6 s.

### Wolves

* **States:** Patrol → Stalk → **Lunge Bite** (wind-up head dip 12f) → **Claw Swipe** (close) → Recover → Howl (only pack/elite) → Re-engage.
* **Pack behavior:** nearest wolf takes lead; others flank with ±30° offsets.
* **Elite White Wolf:** faster (run ×1.12), shorter recoveries (−3f), adds feint (quick half-step).

### Bats

* **States:** Ceiling Idle → Ping (2 pips sfx) → **Sine Dive** → Rebound → Ceiling Reset.
* **Variants:** late-game **Double-Dive** (second arc after a 10f stall).
* **Telegraph:** eyes flash 6f pre-dive; unique screech pitch by tier.

### Skeleton Warriors (Sword/Axe)

* **Sword:** 2-hit chain (mid/mid) or 3-hit (mid-low-high); step-in thrust (gap close).
* **Axe:** horizontal cleave (super-armor wind-up 10f), overhead slam (ground FX).
* **Telegraphs:** shoulder roll (thrust), hip turn (cleave), raised elbows (overhead).
* **Counters:** roll through the first 8f of active swing; safe punish after slam (20–28f).

### Ghost Warrior 3

* **States:** Idle Hover → Short Blink (≤ 2 tiles) → **Attack1** quick cut, **Attack2** step-in slash, **Attack3** long multi-hit (22f active in 3 segments) → Fade-out (invuln 8f) → Reappear.
* **Telegraphs:** cloak flare, low hum; long string shows scything afterimage.
* **Counterplay:** stay close to shorten combos; roll through final segment of long string.

---

## 7) Bosses (move lists & punish windows)

### White Wolf Pack-Leader (Elite)

* **HP 260. Arena:** circular glade.
* **P1:** Bite (12f tell), Double swipe, Cross-dash (tracks mid-range).
* **P2 (≤50%):** **Howl** (1 s) → spawns 2–3 wolves; gains +8% speed for 8 s.
* **Punish:** post-bite 16f window; trunk crash stagger (drop tree on it) 1× per trunk.
* **Goal:** teach crowd priority and elite spacing.

### Fallen Knight (Optional Duel)

* **HP 420. Arena:** crypt pillars.
* **P1:** Lights 1–3, roll catch thrust, aerial slash, slide into uppercut.
* **P2 (≤50%):** “Madness” — every recovery −4f; adds feint into real thrust; flask punishable if you bait.
* **Punish:** bait thrust then roll and strike within 18f; whiff punish uppercut (18f window).
* **Drop:** **Broken Vow** relic.

### Skeleton King (Mid Boss)

* **HP 520. Arena:** pillars + 2 chandeliers (rope HP 1 hit).
* **P1:** Royal Cleave (wide), Shield Bash, Gap-Closer Thrust.
* **P2 (≤50%):** gains **Bone Shard Volley** (3 projectiles; roll-through if close) and **Spectral Summon** (2 reduced-HP skeletons).
* **Punish:** thrust recovery 20f; bash is roll-through → light×2 safe.
* **Drop:** **Throne Seal**, +1 flask slot.

### Angel of Death (Final)

* **HP 780. Arena:** nave; wind pushes; oculus light cone amplifies bloom.
* **P1:** Ground sweep (half screen), Feather fan (5 bolts), short blink.
* **P2 (≤70%):** **Dive Reap** (tracks; leaves lingering wake), **Ring of Wails** (expanding circle—must roll timing), sustained wind.
* **P3 (≤50%):** **Black Halo** (orbiting blades; safe gaps), long teleport feints (two afterimages; only central body deals damage), **8-dir bolts** after every third teleport.
* **Punish:** grounded reaps leave a 20f punish window; after Dive → 24f punish; when halo retracts → 14f.
* **End:** choice on crown at shrine.

---

## 8) Systems (expanded)

**Shrines.** Restores HP, refills flasks, sets respawn; opens **Upgrade** UI (choose 1 line per tier). Fast travel disabled in v1 (placeholder UI greyed).

**Sanity FX.** Hidden meter (0–100). In cursed zones (Pass/Cemetery) rises +8/s; reduces −15/s in torch cones and at shrines. Only affects VFX intensity and whisper volume.

**Keys & Gating.**

* **Crypt Key:** from *Jailor* mini-encounter; opens secret wall (sigil flicker) to Fallen Knight.
* **Throne Seal:** Skeleton King; opens Deadwind pass gate.
* **Oculus Key:** optional platforming branch; opens final nave door (if missed, a short arena awards it after clearing).

**Economy.** Ash Fragments autocollect; drop on death as a **memory echo** (retrieve to regain). Only one echo can exist; dying again deletes the old one.

---

## 9) UX / UI (flows & specs)

**HUD layout (pixel grid).**

* HP bar 96×6 px (top-left), stamina 96×4 px under it; flask pips ×3/4 (10×10 each).
* Boss bar 220×6 px at bottom center; boss name above in small caps.

**Fonts & palettes.**

* Monospace pixel font at 1× scale; UI palette: #E3D7B7 (text), #673F3F (HP back), #C14D4D (HP fill), #4A9A7A (stamina), #C1B158 (accent).

**Onboarding.**

* First-time contextual prompts (**press J to attack, Space to jump, L to roll, Hold Shift to run**) auto-disable after successful use.

**Menus.**

* Pause → Resume, Audio sliders, Color-blind profiles, Camera Shake toggle, VFX Intensity, Controls, Quit.
* Shrine menu → Upgrade (3 tabs), Flask manage (capacity/efficiency choice if unlocked), Travel (disabled v1).

**Accessibility.**

* Disable flashes; reduce shake; high-contrast outline shader; subtitles for whispers & boss callouts; full key & pad remap.
* *No difficulty selector.* (Souls-like identity)

---

## 10) Art & Content Specs (expanded)

**Sprite scale & outline.** pixel-art preserved via NEAREST_SAMPLINGMODE; all gameplay sprites rendered at **1:1 pixel** scale; 1-px darker outline (#1E1E1E) on exterior silhouette. Use 3-tone shading (dark/mid/light) + accent.

**Animation budgets.**

* **Dark Knight** (LuizMelo DK2): 24 states; keep per-state atlases ≤1024²; align feet baseline; pivot tags for hitboxes.
* **Skeleton Warriors:** Sword & Axe share body; per-attack VFX cels for arcs.
* **Ghost Warrior 3:** additive trail layer (separate sprites) for blinks.
* **Bosses:** pack per-phase atlases; avoid >2048².

**Environment pass.**

* **Lighting:** fake 2D lights via emissive sprites + additive quads; do not use dynamic shadow maps.
* **LUTs/Color grading:**

  * Lost Glades: warm-green LUT; Bloom 0.2
  * Dusk Wood: cool blue-green; Fog rgba(40,60,60,0.12)
  * Castle/Prison: cold LUT; ember particles (2–3 systems)
  * Blood Mansion: high contrast; chandelier light cones (static)
  * Deadwind Pass: desaturated LUT + blue vignette pulses tied to sanity level
  * Cemetery/Finale: stark LUT; selective bloom only on stained glass & Angel blades

**FX library.** Impact ring, dust puffs, feather bolts, bone shards, spectral trails, halo blades, shrine glow, on-hit white flash.

---

## 11) Audio (detailed)

**SFX sets (approx 40 clips).**

* Footfalls x3 surfaces, jump/land, roll woosh, light/heavy swings, perfect-roll chime, hit fleshy/metal/ethereal, wolf growls/howl, bat screech (by tier), skeleton clank, ghost blink, shrine hum, gate open, key pickup, boss roars.

**Music.**

* Ambient beds per biome (low strings + pads), with stingers on discovery.
* Boss themes: Skeleton King (taiko + low choir), Angel (choir + organ + sub-boom). Switch to high-energy layer at ≤50% HP.

**Mix targets.**

* Master −16 LUFS integrated; peak −1 dBFS; SFX −12 to −6 LUFS momentary; sidechain duck music −3 dB on boss roar.

**Reverb.** Simple send reverb by biome (Castle/Mansion large hall; Forest small plate; Cemetery cathedral).

---

## 12) Technical Plan (Babylon.js) — Architecture

**Stack.** Babylon.js (CDN, global BABYLON), Vanilla JS (ES modules optional), HTML, CSS, WebAudio. No bundler/build step. (Physics helper—Cannon-ES—deferred; can be added via CDN only for moving platforms later.)

**Runtime files (minimum)**
- `index.html` — `<canvas>` + HUD + CDN scripts
- `styles.css` — HUD/theme, pixel rendering flags
- `main.js` — boot, camera, player controller, animation state machine, HUD hooks

**Optional module splits (as the code grows)**
- `/js/spriteSystem.js` — SpriteManager helpers, baseline detection
- `/js/animController.js` — animation state machine + cancel windows
- `/js/physics2d.js` — AABB, slopes, swept collisions (initially simple)
- `/js/ai/*.js` — enemy FSMs (wolf, bat, etc.)
- `/js/combat.js` — hit/hurt registry, hitstop
- `/js/ui/*.js` — HUD, pause, shrine menus
- `/js/audioBus.js` — SFX/Music buses, sidechain duck
- `/js/postfx.js` — vignette/LUT/bloom via Babylon post-processes

**Data-driven.**

* `data/entities/<enemy>.json`: hp, dmg, speeds, tells (frames), leashes.
* `data/rooms/<biome>/<id>.json`: tiles, props, spawns, connectors, ambient.
* `data/upgrades.json`, `data/keys.json`.

**Post-FX.**

* Vignette, LUT color grading, bloom (selective via emissive mask), chromatic aberration (boss P3 only), sanity pulse (sinusoidal vignette strength). Toggle intensity slider.

**Saving.** LocalStorage JSON; CRC checksum; autosave on shrine rest & room enter.

**Performance.** Texture atlas reuse by family; cull off-screen sprites; pool particle systems; throttle FG effects below 55 FPS.

---

## 13) Numbers & Tuning (full table)

### Player Movement

| Param          | Value                      |
| -------------- | -------------------------- |
| Walk / Run     | 2.7 / 3.3 tiles/s          |
| Accel / Decel  | 1200 / 1400 px/s²          |
| Jump apex hang | 70 ms                      |
| Gravity        | 52 px/s²                   |
| Roll distance  | 2.2 tiles (i-frames 6–18f) |

### Attacks & Costs

| Move    | Startup / Active / Recover | Stamina |          Damage |
| ------- | -------------------------- | ------: | --------------: |
| Light 1 | 8f / 12f / 12f             |      −5 |              12 |
| Light 2 | 8f / 12f / 14f             |      −5 |              12 |
| Light 3 | 10f / 14f / 20f            |      −6 |              16 |
| Heavy   | 18f / 16f / 24f            |     −18 | 30 (42 charged) |

### Enemy (key stats)

| Enemy                      |       HP | Poise |   Dmg |       Move speed |
| -------------------------- | -------: | ----: | ----: | ---------------: |
| Wolf Brown/Grey/Black      | 38/46/60 |    25 |  8/10 |      3.6 tiles/s |
| White Wolf Elite           |      260 |    60 |    12 |      4.0 tiles/s |
| Bat Origin/Gray/Brown/Vamp | 18/26/34 |    10 |   6/8 | Dive 7.0 tiles/s |
| Skeleton Sword/Axe         |   90/110 |    80 | 12/14 |      1.8 tiles/s |
| Ghost Warrior 3            |      120 |    90 |    14 |  Blink ≤ 2 tiles |
| Fallen Knight              |      420 |   120 | 14/22 |      2.8 tiles/s |
| Skeleton King              |      520 |   160 | 16/24 |      1.6 tiles/s |
| Angel of Death             |      780 |   200 | 18/28 |      hover tiers |

---

## 14) Level & Encounter Crafting

**Pacing curve per act**

* *Intro → tension → test → release → climax.*
* Shrines placed after high-attrition rooms; pre-boss calm room for mental reset.

**Spawn tables (examples)**

* **Dusk Wood:** {2 wolves} 60%, {3 wolves} 30%, {2 wolves + 1 bat} 10%.
* **Castle Prison:** {4 bats + 1 skeleton} 40%, {2 skeletons} 40%, {bat swarm 5} 20%.
* **Deadwind Pass:** {ghost + 2 bats} 40%, {ghost + wolf spectral} 40%, {2 ghosts} 20%.

**Secrets**

* Breakable walls use hairline crack tile; lever chains show faint cable path; hidden room reward: flask shard or Ash bundle.

---

## 15) Accessibility & Options (expanded)

* **Flashes:** off/min/normal.
* **Shake:** off/low/normal.
* **Color-blind palettes:** protan/deutan/tritan override for danger hues (telegraphs and bolts).
* **High-contrast outline:** +1 px bright outline shader toggle.
* **Subtitles:** whispers/boss lines with speaker tags.
* **Remap:** all inputs; dead-zone slider for sticks.
* **Assist toggles:** *dev-only flags* for testing (slow time, invuln); not shipped in menu.

---

## 16) QA & Telemetry

**Instrumentation events.** room\_enter, shrine\_rest, enemy\_kill{type}, player\_death{by}, flask\_use, fps\_sample.

**Acceptance per feature.**

* Roll passes through wolf lunge every time with correct timing.
* Perfect roll window verified at 120 ms vs. Skeleton thrust.
* Boss softlocks impossible (adds despawn if stuck off-nav for 5 s).
* Memory echoes always spawn at death position; retrieve restores Ash.

**Playtest goals.** 80% of deaths attributable to readable mistakes; ≤ 1% deaths from off-screen/unreadable hits.

---

## 17) Risks & Mitigations (expanded)

* **Art spread across creators.** Use color grading/LUT + outline rules + shared FX to unify.
* **Browser perf variance.** Offer VFX Intensity slider; auto-reduce bloom on low FPS.
* **Boss scope creep.** Ship P1 then layer P2/P3; reuse base moves with modifiers.
* **Collision edge cases (slopes/elevators).** Early slope testbed; avoid concave ledges; generous ledge forgiveness.

---

## 18) Content & Asset Checklist (fine-grained)

**Hero**

* 24 anims; per-state atlas, per-frame hitboxes (`/data/hitboxes/dk2_<state>.json`).

**Enemies**

* Wolves (3 colors + White elite): idle, run, lunge, claw, hit, death, howl (elite).
* Bats (4 tiers): ceiling idle, ping, dive, rebound, hit, death.
* Skeleton Warriors (Sword/Axe): ready, walk, run, jump, attack1/2/3, hit, death.
* Ghost Warrior 3: idle, move, attack1/2/3, hit, death, blink FX.
* Fallen Knight: all core combat states.
* Bosses: Skeleton King (P1/P2 moves), Angel (P1/P2/P3 moves).
* **FX atlases:** impact, dust, shards, halo, feathers.

**Environments**

* Tiles, props, parallax layers, light cones per biome; interaction markers; breakable variants.

**Audio**

* SFX lists per action; looped ambiences per biome; two boss tracks + stingers.

**UI**

* HUD sprites, boss bar frames, shrine screens, pause/options.

---

## 19) Release Scope vs. Stretch

**v1 (8-week playable):**

* 5 biomes (compact) with \~30–40 rooms total; wolves/bats/skeletons/ghosts; White Wolf elite; Fallen Knight (optional); Skeleton King; Angel of Death; shrines & upgrades; 2 relics; save/load; post-FX pass; accessibility set; one difficulty.

**Stretch (post-v1):**

* Second Skeleton variant if cut; NG+ modifiers (harder teleports, bolt patterns); secret areas; extra relics; environmental hazards (swing blades, crumble bridges); speedrun timer; lore notes & gallery.

---

## 20) Pipeline & Conventions (production-ready)

**Repo layout**

```
/index.html
/styles.css
/main.js
/js/...(optional module splits)
/assets/sprites/<family>/<state>.png
/assets/fx/...
/assets/audio/sfx|music
/data/entities/.json
/data/rooms/<biome>/.json
/data/upgrades.json
```

**Naming & states**

* States use snake_case: `idle`, `walk`, `run`, `jump_start/mid/end`, `roll`, `light1/2/3`, `heavy_charge/release`, `hurt`, `death`.
* Aseprite export: JSON (hash) with frame durations; origin pivots consistent (feet at y0).

**Coding standards**

* Vanilla JS with **JSDoc types** for editor IntelliSense.
* Optional Prettier/ESLint (browser globals); small, isolated commits.

---


# Production Roadmap
---

# Phase 0 — Bootstrapping & Tooling (Day 1–2)

**Goals**
Stand up a zero-build, CDN-powered Babylon page with debug overlay and data stubs.

**Tasks**
- Create `index.html`, `styles.css`, `main.js`.
- Add Babylon CDN `<script>` and minimal WebAudio init.
- Debug overlay: FPS + toggles (colliders, slow-mo) — stubs OK.
- Prepare JSON schemas for `/data` (entities/rooms/hitboxes) — docs for now.
- Serve via **Live Server** (or `python -m http.server`) — not `file://`.

**Deliverables**
- Canvas renders at 60 FPS (orthographic camera).
- Baseline player sprite anim plays; HUD bars visible.
- Overlay hotkeys respond.

**Definition of Done**
- No console errors/404s.
- F1 overlay, F2 colliders (stub), F3 slow-mo (stub) toggle.

**Test script**
Open `index.html` via Live Server → toggle overlay → verify FPS & input hints update.

---

# Phase 1 — Player Controller & Core Feel (Week 1)

**Goals**

* Ship a responsive Dark Knight with full locomotion, stamina, roll i-frames, flasks, and camera.

**Tasks**

* Implement movement (accel/decel, coyote, input buffer), jump (start/mid/end), roll (i-frames 6–18f), climb ladders.
* Stamina & HP systems + UI bars; Oath Flasks (3) with roll-cancel after 0.5 s.
* Light 1/2/3 and Heavy/Charge attacks with cancel rules; hitstop; camera micro-shake (toggle).
* Tune perfect-roll window (120 ms) with stamina refund; add perfect-roll SFX chime.
* Interaction prompt; shrine prototype (heal, respawn only).
* Hook `AnimController` to Aseprite timing; feet-baseline alignment.

**Deliverables**

* **Lost Glades Graybox**: flat ground + ladder + shrine; dummy target to hit/roll.

**DoD**

* 60 FPS; inputs feel snappy; all animations transition cleanly; stamina drains/regens per GDD.

**Test script**

* Perform: 3-hit light chain → roll cancel; charged heavy → stagger dummy; perfect roll window feels tight but fair; flask roll-cancel works.

---

# Phase 2 — Combat Spine & First Enemies (Week 2)

**Goals**

* Finalize the combat engine (hit/hurtbox registry, hitstop) and introduce Wolf + Bat with real AI.

**Tasks**

* `Combat` module: overlap tests, damage calc, invuln flags.
* Generic FX pool: impact rings, dust, white flash shader; SFX hookups.
* **Wolf AI** (Brown/Grey): patrol → stalk → lunge bite (tell pose 12f) → claw; pack logic (lead + flank).
* **Bat AI** (Origin): ceiling idle → ping → sine dive → rebound → ceiling reset.
* **Shrine v1**: heal, set respawn, refill flasks; save to localStorage.
* **HUD v1**; pause/options (audio sliders, shake toggle, remap placeholders).

**Deliverables**

* **Playable Tutorial** (Lost Glades): one wolf, one bat teach encounters; shrine and respawn.

**DoD**

* Perfect roll through wolf lunge works; bat dives are readable (eye flash + screech); save/respawn solid.

**Test script**

* Die to wolf → respawn at shrine with echo left behind; retrieve echo restores Ash (placeholder value).

---

# Phase 3 — Biome Pipeline & Act I (Dusk Wood + White Wolf Elite) (Week 3)

**Goals**

* Turn the pipeline into content: tiles, parallax, fog/LUT; spawn tables; Act I finish with elite fight.

**Tasks**

* Tile collisions (slopes 22.5°/45°), one-way platforms; moving platform stub.
* Parallax stack (BG3→FG), LUT per biome; fog volume; ambient SFX (forest).
* Spawn tables + connectors; secrets (breakable wall).
* **Wolf variants** (Black; \~+dmg/speed) and **Pack-Leader (White)** elite:

  * Arena setup; P1 bites/swipes; P2 howl summons 2–3 wolves; destructible trunks gimmick; reward: **Howl Fragment** relic.
* Shrine mid-biome; Ash Fragments award tuned.

**Deliverables**

* Dusk Wood: 6 rooms + 1 shrine + wolf-pack room + White Wolf elite fight; transition door to Castle Prison.

**DoD**

* Average room stays < 140 draw calls; < 100 active sprites; 60 FPS stable.

**Test script**

* Beat White Wolf; confirm relic drop; confirm gate opens to Castle Prison.

---

# Phase 4 — Act II (Castle Prison: Bat Swarms + Skeleton Warriors + Key Puzzle) (Week 4)

**Goals**

* Introduce bats as swarms and Skeleton Warrior (Sword + Axe), plus the key-gate to Fallen Knight.

**Tasks**

* Ceiling bat clusters (4–5 per room) with aggro radius; dive cadence tuning (no “shotgun” overlaps).
* Skeleton Sword: 2–3 hit strings, thrust gap-closer; Axe: cleave + overhead with ground FX; perfect-roll windows strict but fair.
* **Portcullis puzzle** (3 bells in 5 s) → opens **Jailor** room (Axe variant) → **Crypt Key** drop.
* Hidden wall (sigil flicker) uses key → door to optional duel (kept locked until key acquired).
* Performance pass on swarms (culling, pooling).

**Deliverables**

* Castle Prison: \~6 rooms + shrine + key puzzle + clear difficulty ramp; door to Blood Mansion; hidden entrance to Fallen Knight (locked if no key).

**DoD**

* Skeleton tells distinct (hip/shoulder tells); thrust first swing leaves a punish window after a perfect roll; swarms never drop FPS under 55.

**Test script**

* Clear a bat swarm without unseen hits; get key; unlock hidden door; optionally skip it and continue.

---

# Phase 5 — Optional Duel & Mid-Boss (Fallen Knight + Blood Mansion + Skeleton King) (Week 5)

**Goals**

* Ship the optional duel and the Skeleton King boss wall; solidify boss UI and drops.

**Tasks**

* **Fallen Knight**: P1 normal combos; P2 (≤50% hp) “Madness” (−4f recovery, feints). Flask punishable. Drop **Broken Vow** relic (+20 ms perfect-roll grace).
* **Blood Mansion**: 1–2 rooms, chandelier hazard (rope cut) and one turret statue.
* **Skeleton King**: P1 cleave/bash/thrust; P2 volley + summon 2 skeletons; chandelier drop stagger (optional gimmick). Drop **Throne Seal** + +1 flask slot.
* Boss UI polish: nameplate, unique theme layers.

**Deliverables**

* Act II complete; gate to Deadwind Pass unlocked.

**DoD**

* Both arenas reset cleanly on death; no enemy softlocks; boss drops saved.

**Test script**

* Beat Fallen Knight (optional) and Skeleton King; confirm +1 flask, Seal, and relic inventory saved.

---

# Phase 6 — Act III Part 1 (Deadwind Pass + Spectral Variants + Ghost Warrior 3) (Week 6)

**Goals**

* Deliver the hardest traversal, new spectral wolves, Ghost Warriors, wind mechanics, and Oculus Key branch.

**Tasks**

* Wind volumes (± push, modifies jump arcs); sanity VFX ramp in this biome.
* **Spectral wolves**: shader tint + glow; small stat bump; otherwise wolf AI reused.
* **Ghost Warrior 3**: blink, short/step-in/long multi-hit strings; afterimage FX; counter-windows.
* Platforming branch to **Oculus Key**; shrine before final zone.

**Deliverables**

* Deadwind Pass playable; exits to Forgotten Cemetery (locked if no key unless arena alternative is cleared).

**DoD**

* Ghost telegraphs (cloak flare, hum) readable; wind doesn’t break jumps; sanity VFX obeys intensity slider.

**Test script**

* Retrieve key via branch; or clear small arena to earn it; proceed to Cemetery.

---

# Phase 7 — Act III Part 2 (Forgotten Cemetery + Final Boss + Endings + Balance Pass 1) (Week 7)

**Goals**

* Build the finale (Angel of Death P1–P3), endings, basic NG+ flagging, and a first global balance pass.

**Tasks**

* **Angel of Death**:

  * P1: sweep + feather fan + short blink.
  * P2: dive reap + Ring of Wails; wind amplified.
  * P3: Black Halo blades + long teleports with afterimage feints + 8-dir bolts.
  * Parry only on grounded reaps; punish windows per GDD.
* Ending choice UI at shrine (Absolution vs Taken); set NG+ flag to true (affects later runs).
* Balance pass: enemy hp/dmg, perfect-roll windows verify (120 ms), flask sip timings; first audio mix pass (ducking, organ/choir levels).

**Deliverables**

* Full playthrough end to end; credits stub; NG+ flag displayed on title if set.

**DoD**

* No crashes on retry; boss phases switch reliably; music layers swap at ≤50% HP.

**Test script**

* Beat Angel; view both endings via re-fight; verify NG+ toggle.

---

# Phase 8 — Polish, Accessibility, Optimization, Release Candidate (Week 8)

**Goals**

* Hit perf, tighten input feel, finalize post-FX, accessibility, SFX/music mix, and a stable **static** web build.

**Tasks**

* Perf: texture trimming/atlases, sprite pooling, cull rules, throttle particles under 55 FPS; optimize PNGs (oxipng/zopfli); audio to OGG @ 160 kbps VBR.
* Post-FX tuning per biome (LUTs, bloom on stained glass only; sanity vignette pulse).
* Accessibility: flashes off/min/normal; shake off/low/normal; color-blind palettes; subtitles; remap UI polish.
* QA: run **encounter checklists** (below); fix fatal issues; save schema versioning; localStorage reset tool.
* **Deploy static site** via GitHub Pages / Netlify / Cloudflare Pages.
* Add `credits.html` + favicon.

**Deliverables**

* **v1 Release Candidate** URL; internal patch notes; “How to test” guide for you.

**DoD**

* 60 FPS on mid-range laptop in all rooms; no blockers; telemetry events logging; licenses present.

**Test script**

* Full clean run, fresh browser profile; report perf dips, readability issues, or unfair hits.

---

## Reusable Checklists (keep handy)

### Enemy Feature Checklist (per type)

* [ ] Idle/Move/Attack(s)/Hit/Death animations wired, feet aligned
* [ ] Telegraph pose (≥ 10–12 frames) + unique SFX
* [ ] Hit reaction timings tuned
* [ ] Parryable segment defined (frame range)
* [ ] Spawn/despawn rules & leash
* [ ] FX & hitstop tuned
* [ ] Performance under ≥5 concurrent instances

### Boss Checklist

* [ ] P1 complete & winnable
* [ ] P2/P3 add mechanics, not raw HP
* [ ] Arena hazards reset; camera bounds; intro skip after first attempt
* [ ] Boss bar + name; music layers; death & drop
* [ ] Save progress; door gating; retry loop fast

### Room Checklist

* [ ] 22–40×12–22 tiles; ≤ 2 hazards; ≤ 8 concurrent enemies
* [ ] Spawns via table template; secrets hooked
* [ ] Ambient SFX & LUT set; fog & parallax present
* [ ] Shrine placement tested (if present)
* [ ] Perf: draw calls < 300, sprites < 100

### Audio/Mix Checklist

* [ ] Footsteps (3 surfaces), swing, perfect-roll chime, hurt, death per family
* [ ] SFX balance vs music; sidechain on boss roar
* [ ] Loop points clean; boss transitions flawless

---

## Telemetry (always-on)

* `room_enter`, `shrine_rest`, `player_death {by}`, `flask_use`, `fps_sample`, `boss_phase_change`, `echo_drop/recover`.
* Use overlay (**F9**) to dump last 200 events to console.

---

## Scope Brakes (pull these if timing slips)

1. **Cut Axe Skeleton** (ship Sword only) — still communicates “heavy” via overhead on sword.
2. **Remove chandelier hazard** in Mansion — focus King core kit.
3. **Angel P3 simplification** — fewer halo blades (4 → 2) and slower teleports.
4. **Reduce Deadwind rooms** by 1; keep Oculus branch.
5. **One relic only** (Broken Vow); add Howl Fragment in a patch.

---

## Daily Dev/Test Handshake (short)

* **Morning (dev):** implement 1–2 cards from current phase; push branch; open short changelog.
* **Evening (you):** play the new build; file notes by *room/boss/enemy* with timestamps; mark *unfair vs learnable*.
* **Night (dev):** address fast fixes; tag next “nightly”.

---

## Milestone Gates

* **Gate A (end W2):** Tutorial vertical slice (Lost Glades) clear & fun.
* **Gate B (end W3):** White Wolf elite fight feels like a duel; no cheap shots.
* **Gate C (end W5):** Mid-game complete; King beaten; perf stable.
* **Gate D (end W7):** Finale complete; both endings fire; first balance pass done.
* **Gate E (W8):** Perf/accessibility pass; RC build live.

---

## Asset Pull Order (so we never block)

1. Dark Knight DK2 (LuizMelo)
2. Wolves (SanctumPixel) + FX
3. Bats (SanctumPixel)
4. Anokolisa tiles: **Lost Glades, Dusk Wood**
5. Skeleton Warriors (sword→axe)
6. Castle Prison + Blood Mansion tiles
7. Fallen Knight (SpellSoft)
8. Skeleton King (SanctumPixel)
9. Deadwind Pass + Cemetery tiles
10. Ghost Warrior 3 (LuizMelo)
11. Angel of Death (SanctumPixel)
12. Music & SFX packs

---

## Build/Release Notes Template (fill every nightly)

* New:
* Tuning:
* Fixes:
* Known issues:
* Perf snapshot (min/avg/max FPS):

---
