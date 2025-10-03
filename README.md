# GDD — “Echoes of the Ruin”

*(2.5D pixel-art action platformer for the web, built with Babylon.js; one punishing difficulty; no casual modes)*

---

## 1) High-Concept

**USP / Fantasy.**
A tightly-scoped, browser-playable souls-like with **precise 2D combat readability** and **atmospheric presentation** powered by Babylon.js (parallax layers, LUT-driven lighting, subtle post-FX). The fantasy is mastery through discipline: players learn to read strict telegraphs and punish windows in a hostile, mysterious world.  

**Inspirations**  
- Hollow Knight → clarity of combat & animation readability  
- Dead Cells → replayability, input feel, procedural interior layouts  
- Blasphemous → tone, environmental storytelling  
- Classic Souls → shrines, risk/reward, no difficulty toggles 

**Play cadence.**

* *Micro loop:* explore → scout tells → commit → punish or get punished → shrine recover.
* *Session loop:* push to next shrine → boss wall → skill gain → repeat.
* *Run loop:* 2–3 hours for first clear; subsequent clears \~60–90 minutes.

**Constraints.** Pixel art; \~64 MB texture budget; 60 FPS on mid-range laptops; no online features.

---

## 2) Design Pillars

1. **Readable, lethal combat**  
   - All enemy attacks have unique wind-up poses & audio cues.  
   - Punish windows ≥ 12 frames.  
   - Never unfair: no off-screen surprise hits.  
   - On-screen chaos capped (≤1 full-screen FX burst at once).  

2. **Atmosphere > exposition**  
   - No cutscenes >8s.  
   - Lore mostly environmental (~90%).  
   - Optional lore items expand narrative for players who seek it.  

3. **Lean progression**  
   - ≤3 upgrade lines in v1.  
   - ≤3 relics in v1.  
   - No crafting, loot tables, or overcomplexity.  

4. **Cohesive art & sound**  
   - Palette rules: muted mids + cold highlights.  
   - Shared outline rules, shading style.  
   - Unified reverb per biome.  
   - Single, coherent FX suite (impact rings, dust, flashes).  

5. **Web-first performance**  
   - ≤300 draw calls, ≤100 active sprites, ≤10 particle systems simultaneously.  
   - Reuse texture atlases.  
   - Browser-stable performance monitoring with fallback VFX reductions.

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

## 5) Biomes & Level Design (Revised for PCG)

**Metrics**
- Tile size: 16×16 px.
- Room span: 22–40 tiles wide, 12–22 tall.
- Procedural interiors: each biome is composed of 5–8 reusable templates (authored), assembled into a valid path per seed.
- Shrines: **only at biome transitions**. Each biome must be replayed fully after death.

### Lost Glades (Tutorial)
- 3 compact handcrafted rooms (non-PCG).  
- Teaches rolls, jumps, spacing against wolves, anti-air vs. bats.  
- First shrine: unlocks progression systems.

### Dusk Wood (Act I)
- Procedural: 6 rooms per run from tagged templates (combat, hazard, elite candidate).  
- Hazards: collapsing logs, shallow water (20% slow).  
- Elite: White Wolf Pack-Leader (fixed arena template at end).  

### Castle Prison (Act IIa)
- Procedural: ~6 rooms per run.  
- Puzzle room (timed portcullis) guaranteed once per seed.  
- Key reward: Crypt Key.  
- Bat swarms and skeleton patrols seeded differently per run.  

### Blood Mansion (Act IIb)
- 2–3 room templates before boss.  
- Hazards: chandeliers, turret statues.  
- Skeleton King arena fixed at endcap.  

### Deadwind Pass (Act IIIa)
- Procedural: ~5 rooms per run.  
- Hazards: wind zones (±15% push), narrow ledges.  
- Oculus Key placed via seeded branch path (platforming challenge or optional arena).  

### Forgotten Cemetery (Act IIIb)
- 2 room templates (always short for pacing).  
- Hazards: collapsing graves, cursed fog.  
- Angel of Death arena fixed at endcap.  

**Design impact:**  
Each biome feels like a self-contained gauntlet. Replayability is driven by procedural interior reshuffling, while authored elite/boss encounters preserve narrative anchors.

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

## 8) Systems (Revised)

**Shrines (Biome Transitions Only)**  
- Located **only between biomes**, acting as gates.  
- Functions: heal, refill flasks, checkpoint, upgrade UI.  
- Trigger fresh PCG seed generation for the next biome.  
- No mid-biome shrines. Biomes are all-or-nothing challenge chambers.  

**Death & Respawn (Roguelite Model)**  
- Death resets progress to the last shrine at the **start of the current biome**.  
- No echoes, no Ash retrieval. Ash is banked automatically.  
- The biome is regenerated with a new seed after death.  
- Consequence: tension and replayability per biome attempt.  

**Sanity FX**  
- Unchanged mechanically, but now resets on shrine respawn.  
- Still purely audiovisual; ramps in cursed zones, mitigated at shrines/torches.  

**Keys & Gating**  
- Keys (Crypt, Throne Seal, Oculus) ensure progression remains deterministic despite PCG.  
- Path validation guarantees placement of key/puzzle rooms before biome exits.  

**Economy**  
- Ash Fragments remain primary currency.  
- Always collected automatically.  
- No echoes dropped on death — simplifies runs, aligns with Dead Cells loop.  

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

## 16) QA & Telemetry (Revised)

**Events Logged (Updated for PCG & Shrines)**  
- `room_enter {id, biome, seed}`  
- `shrine_rest {biome, seed, flask_count, upgrades}`  
- `biome_seed_start {biome, seed}`  
- `biome_complete {biome, time, deaths}`  
- `biome_failed {biome, elapsed_time, death_by}`  
- `enemy_kill {type}`  
- `player_death {by, biome}`  
- `flask_use`  
- `fps_sample`  
- `boss_phase_change {boss, phase}`  
- `boss_defeated {boss, seed}`  

**Test Goals**  
- Player respawns always at **biome start shrine**.  
- New seed generated on respawn; room layouts differ across runs.  
- Boss/elite endcaps always reachable in generated graphs.  
- No softlocks: validator guarantees keys & shrines placed in solvable paths.  
- 80% deaths remain readable; ≤1% caused by unfair procedural overlap.
  
---

## 17) Risks & Mitigations (Revised)

- **Procedural repetition.**  
  Risk: small template pool feels repetitive.  
  Mitigation: author 8–10 room templates per biome; tag-based variance (combat, hazard, puzzle).  

- **Unfair procedural layouts.**  
  Risk: rooms generate unwinnable combos (e.g., too many hazards).  
  Mitigation: validator enforces biome flow rules (entrance → shrine → boss/elite reachable).  

- **Player disorientation.**  
  Risk: repeated resets cause fatigue.  
  Mitigation: biomes short (6–8 rooms max). Subtle cues (ambient FX, fog color) guide progress.  

- **Complex shrine logic removed.**  
  Risk: no mid-biome checkpoints frustrate some players.  
  Mitigation: high tension is intended. Game identity aligns with roguelite loop.  

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

* Implement movement (accel/decel, coyote, input buffer), jump (start/mid/end), roll (i-frames 6–18f).
* Stamina & HP systems + UI bars; Oath Flasks (3) with roll-cancel after 0.5 s.
* Light 1/2/3 and Heavy/Charge attacks with cancel rules; hitstop; camera micro-shake (toggle).
* Tune perfect-roll window (120 ms) with stamina refund; add perfect-roll SFX chime.
* Interaction prompt; shrine prototype (heal, respawn only).
* Hook `AnimController` to Aseprite timing; feet-baseline alignment.

**Deliverables**

* **Lost Glades Graybox**: flat ground + shrine; dummy target to hit/roll.

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

# Phase 2.5 — Procedural World Foundation: Room Graph & Biome Generator (Days 10–14)

## 🎯 Goals
- Build the **procedural generation backbone** that powers all biomes.  
- Support **deterministic seed-based runs** with guaranteed replayability and consistent pacing.  
- Ensure **biome-level structure**: one entrance, one exit, no mid-biome shrines.  
- Death always respawns the player at the last **inter-biome shrine**, regenerating the biome with a fresh seed.  
- Provide robust **debugging and validation tools** to ensure PCG stability.

---

## 🗂️ Scope Overview
- **Macrostructure:** Acts/biomes remain fixed (Lost Glades → Dusk Wood → Castle Prison → … → Angel).  
- **Microstructure:** Each biome’s interior is procedurally generated per seed using reusable **room templates**.  
- **Checkpoints:** Shrines exist only at biome intersections, acting as entry/exit hubs.  
- **Death flow:** Dying mid-biome respawns at the prior shrine; the biome resets with a new seed.  

This ensures **fresh layouts every run** while preserving narrative flow and difficulty progression.

---

## 📦 Core Deliverables
- ✅ **RoomTemplate JSON schema** for reusable room definitions.  
- ✅ **RoomGraph generator** that assembles valid biome layouts per seed.  
- ✅ **Biome loader** to instantiate room templates into world geometry.  
- ✅ **Seed manager** for generation, storage, and deterministic replay.  
- ✅ **Debug UI (F8)**: visualizes seed and graph, allows regen/export.  
- ✅ **5+ prototype templates for Lost Glades** (combat, traversal, fork, vertical, secret candidate).  

---

## 🛠️ Key Systems to Implement

### 1. RoomTemplate Spec & Data Format
Define reusable room templates in JSON (example):

{
"id": "glades_combat_01",
"biome": "lost_glades",
"tags": ["combat", "common"],
"exits": ["east", "west"],
"enemyBuckets": ["wolves_basic", "bats_basic"],
"spawnWeight": 1.0,
"minDepth": 1,
"maxDepth": 3,
"hazards": ["pit_small"],
"secretCandidate": false
}

- **Tags:** combat, elite_candidate, secret_candidate, boss_arena, fork.  
- **Exit constraints:** ensures graph connectivity.  
- **Spawn buckets:** link to biome-specific enemy tables.  
- **Depth gating:** early rooms easier, deeper rooms harder.  

---

### 2. RoomGraph Generator
- Creates **biome-level graphs** seeded deterministically.  
- Guarantees:
  - Single entrance → single exit.  
  - At least one elite candidate room.  
  - Optional secret candidate.  
- Selects rooms by **tag weighting** to avoid repetition.  
- Validates paths: no orphaned or unreachable rooms.  
- Outputs a JSON graph object for the runtime to parse.  

---

### 3. Biome Assembly & Loader
- Converts RoomGraph → instantiated rooms in engine.  
- Handles:
  - Exit/entrance alignment.  
  - Asynchronous loading between rooms with fade.  
  - Biome ambience (fog, LUT, ambient audio).  
- Exit node always links to the **inter-biome shrine**.  

---

### 4. Seed Manager & Persistence
- Generates new seed at shrine transition or new run.  
- Stores seeds per-biome in `RunData`.  
- Manual override for testing.  
- Deterministic replay: same seed → identical graph/layout/spawns.  
- Logs seeds to console + telemetry for bug repro.  

---

### 5. Debug & Validation Tools
**Debug Overlay (F8):**
- Display: seed, biome name, room count.  
- Visualize graph: nodes color-coded (combat = grey, elite = red, boss = gold, secret = blue).  
- Hover: room ID, tags, depth.  
- Buttons: “Regenerate Seed,” “Export Graph JSON.”  

**Validation Tests:**
- 50+ seeds per biome: confirm entrance → exit path always exists.  
- Elite candidate spawns with expected frequency.  
- Build time <200 ms.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Define `BiomeConfig` for Lost Glades | enemy buckets, fog, props |
| Author 5+ Lost Glades templates | combat, fork, vertical, secret |
| Implement `RoomGraph.validate()` | shrine + elite path guaranteed |
| Hook transitions to PCG graph | hero exits trigger next room load |
| Add telemetry events | `biome_seed_start`, `biome_failed`, `biome_complete` |

---

## 🧪 Testing
- **Seed stability:** replay same seed 3× → identical graphs and spawns.  
- **Graph validity:** 50 random seeds → no unreachable exits.  
- **Death loop:** die mid-biome → respawn at prior shrine → biome regenerates with new seed.  
- **Arena validation:** elite candidate always appears once; boss arena reachable in future phases.  
- **Performance:** seed-to-world build <200 ms, no frame hitches.  

---

## ✅ Definition of Done (DoD)
- Biomes generate procedurally per run with tagged templates.  
- Seeds are deterministic and replayable.  
- Death respawns at last inter-biome shrine; biome resets with new seed.  
- Debug UI shows full seed + graph; supports regeneration and export.  
- Lost Glades biome playable with at least 5 functional templates.  
- No console errors; 60 FPS stable.  

---

## 🔮 Long-Term Extensions
- Expand template libraries to 12–15 per biome.  
- Add branching/forking path logic.  
- Introduce rare “corrupted” templates for Aberration system.  
- Support Daily Seeds and community challenges.  
- Hook meta-progression into seed history.  

---

# Phase 2.6 — Biome Transition Shrines & Run Reset Logic (Days 13–14)

## 🎯 Goals
- Finalize the **biome transition system**: shrines act as checkpoints only between biomes.  
- Remove all mid-biome shrine/echo logic in favor of roguelite-style **run resets**.  
- Ensure death always returns the player to the last transition shrine, regenerating the biome with a new seed.  
- Add telemetry/logging for runs, deaths, and biome completions.

---

## 🗂️ Scope Overview
Shrines no longer appear inside biomes. Instead:  
- **At biome entry:** shrine serves as a checkpoint, full heal, flask refill, and seed generator for the upcoming biome.  
- **At biome exit:** shrine locks progress (RunData), regenerates the next biome’s seed, and transitions the player forward.  
- **On death inside a biome:** player returns to last shrine → full biome is replayed with a **fresh procedural seed**.  

This replaces the old **echo recovery loop** with a simpler, roguelite-friendly **risk/reward loop**.  

---

## 📦 Core Deliverables
- ✅ Transition Shrine prefab (visual, interaction, FX).  
- ✅ Biome reset logic on death (regenerate room graph with new seed).  
- ✅ RunData object to track seeds, relics, flask count, relic inventory.  
- ✅ Shrine activation FX: heal VFX, audio cue, ambient glow.  
- ✅ Telemetry events: `biome_seed_start`, `biome_failed`, `biome_complete`, `biome_transition`.  

---

## 🛠️ Key Systems to Implement

### 1. Transition Shrine Prefab
- **Functions**:  
  - Heal player to full HP.  
  - Refill flasks to max.  
  - Save checkpoint state (RunData).  
  - Generate new procedural seed for upcoming biome.  
  - Transition the player to the next biome (via fade + load).  
- **Visuals**:  
  - Ambient glow.  
  - Shrine pulse FX when activated.  
  - Light flicker/shadow on surrounding tiles.  
- **Audio**:  
  - Low hum loop.  
  - Activation chime.  

### 2. Run Reset Logic
- **On death inside biome**:  
  - Respawn at last shrine (biome entrance).  
  - Full HP/flask reset.  
  - Current biome is regenerated with a **fresh seed**.  
- **On completion of biome**:  
  - Exit shrine transitions to next biome.  
  - Save relics, flask upgrades, NG+ flags to RunData.  

### 3. RunData Object
- Stores:  
  - Current biome name.  
  - Seeds per biome.  
  - Relics acquired.  
  - Flask count.  
  - Progression flags (keys, seals).  
- Persists between biomes until run ends.  

### 4. Telemetry Hooks
- `biome_seed_start {biome, seed}` — logged when new seed begins.  
- `biome_failed {biome, elapsed_time, death_by}` — logged on death inside biome.  
- `biome_complete {biome, seed, time}` — logged when exit shrine reached.  
- `biome_transition {from, to, run_id}` — logged on shrine activation between biomes.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Replace all mid-biome shrine references | Remove old echo/respawn mentions |
| Add shrine interaction prompt | “Rest at shrine (E)” |
| Fade transition logic | Smooth fade-out/in on biome swap |
| Shrine FX prefab | Pulse glow + heal burst |
| RunData persistence | Stored in memory, optional localStorage for debug |
| Debug console | Print current biome + seed on shrine activation |

---

## 🧪 Testing
- **Death loop test:** Die inside Dusk Wood → respawn at Lost Glades shrine → biome regenerates with fresh seed.  
- **Transition test:** Reach exit shrine → HP/flasks refill → Castle Prison generated.  
- **Seed test:** Replay same biome multiple times with same seed → identical layout; new seed → fresh layout.  
- **FX test:** Shrine glow, pulse, heal animation play correctly.  
- **Telemetry test:** Logs match shrine activations, biome completions, and failures.  

---

## ✅ Definition of Done (DoD)
- Inter-biome shrines functional as the **only checkpoint system**.  
- Death always returns player to last shrine; biome regenerates with fresh seed.  
- Shrine interaction heals, refills, and saves state (RunData).  
- Seeds deterministic + replayable for debugging.  
- Telemetry events recorded for biome start, failure, completion, and transitions.  
- Shrine FX + SFX working and visually polished.  

---

## 🔮 Long-Term Extensions
- Add **upgrade menus** at shrines (future meta-progression).  
- Introduce NPCs at shrines with branching dialogue.  
- Daily Seed Mode: shrine shows today’s seed ID.  
- Multiplayer hooks: seed-sync via shrine activation.  

---

# Phase 3 — Biome Pipeline & Act I (Dusk Wood + White Wolf Elite) (Week 3)

## 🎯 Goals
- Establish the **first full procedural biome** (Dusk Wood) using the PCG foundation from Phase 2.5.  
- Author and validate a **room template library** for Dusk Wood, tagged for combat, traversal, secrets, and elite encounters.  
- Implement biome-specific **visual identity** (tiles, parallax, LUTs, fog, ambient SFX).  
- Introduce **wolf variants** (Black Wolf and White Wolf Elite).  
- Deliver a **complete Act I run** from shrine (Lost Glades exit) → Dusk Wood procedural rooms → White Wolf elite fight → shrine to Castle Prison.

---

## 🗂️ Scope Overview
Dusk Wood is the first true biome in the fixed act order. Its purpose is to:  
- Teach the player to handle multiple wolf threats (pack coordination).  
- Showcase procedural room variation for replayability.  
- Deliver the first “mini-boss” style fight (White Wolf).  

All rooms will be generated **procedurally per seed** using authored templates. The flow is always:  
**Entrance (from shrine) → procedural rooms → White Wolf elite arena → exit shrine → Castle Prison.**

---

## 📦 Core Deliverables
- ✅ 8+ **Dusk Wood room templates** (combat, traversal, fork, secret candidate, vertical).  
- ✅ **BiomeConfig** for Dusk Wood (fog LUT, parallax stack, ambient forest SFX, spawn tables).  
- ✅ **Wolf variants**:  
  - Black Wolf (stat boost: +dmg/speed).  
  - White Wolf Pack Leader (elite).  
- ✅ **Elite arena** template (large clearing with destructible trunks gimmick).  
- ✅ Reward system: defeating White Wolf drops **Howl Fragment relic**.  
- ✅ Biome entry/exit shrines (Lost Glades → Dusk Wood → Castle Prison).  

---

## 🛠️ Key Systems to Implement

### 1. Dusk Wood Room Template Library
- Author 8+ templates for Dusk Wood:  
  - **Combat rooms**: open clearings, tight choke points.  
  - **Traversal rooms**: slopes (22.5°/45°), vertical climbs, one-way platforms.  
  - **Fork rooms**: multiple exits for branching.  
  - **Secret candidates**: breakable walls revealing loot or shortcuts.  
  - **Elite arena**: fixed large room for White Wolf fight.  
- Each template tagged with difficulty tier (`early`, `mid`, `elite`).  
- Validate exit alignment for seamless PCG chaining.  

### 2. BiomeConfig (Dusk Wood)
- **Visuals**:  
  - Tile set: forest ruins.  
  - Parallax stack: BG3 → FG layers (trees, mist, ruins).  
  - LUT: moody green/blue palette.  
  - Fog: low, drifting ground fog volume.  
- **Audio**:  
  - Ambient forest loop (wind, distant howls).  
  - Layered SFX triggers (creaking trees, wolf howls).  
- **Spawn tables**:  
  - Common: Grey Wolf (solo, pairs).  
  - Uncommon: Bat (ceiling ambush).  
  - Rare: Black Wolf variant.  
  - Elite: White Wolf (guaranteed arena).  

### 3. Wolf Variants
- **Black Wolf**:  
  - Faster run-in speed, slightly harder-hitting.  
  - Same AI skeleton as Grey Wolf.  
- **White Wolf (Elite)**:  
  - **P1:** bite + claw combos.  
  - **P2 (≤50% HP):** howl → summon 2–3 wolves (pack leader mechanic).  
  - **Arena gimmick:** destructible trunks (can be broken for tactical positioning).  
  - **Reward:** Howl Fragment relic (permanent unlock).  

### 4. Inter-Biome Shrines
- **Entry shrine:** transitions player from Lost Glades into Dusk Wood with new seed.  
- **Exit shrine:** activates after defeating White Wolf, restoring flasks/HP and generating Castle Prison seed.  
- No shrines inside Dusk Wood itself.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Implement slope collisions | 22.5° + 45°, plus one-way platforms |
| Add destructible trunks prefab | Physics + FX when broken |
| Expand FX pool | Wolf bite/claw impact dust; elite howl aura |
| Camera tuning | Wide zoom for White Wolf arena |
| Reward handling | Howl Fragment relic saved to RunData |
| Biome telemetry | `biome_seed_start`, `biome_failed`, `biome_complete` |

---

## 🧪 Testing
- **PCG seed tests:** 20 random seeds generate valid Dusk Wood graphs (entrance → elite → exit).  
- **Wolf variant tests:** Black Wolves spawn at correct rarity; White Wolf always spawns in elite arena.  
- **Combat feel:** Perfect-roll through wolf lunge still works (from Phase 2 core logic).  
- **Shrine flow:** Death inside Dusk Wood → respawn at Lost Glades exit shrine → new seed generated.  
- **Arena test:** Destructible trunks break correctly; White Wolf summons 2–3 wolves in P2.  
- **Performance:** Room build + transitions <200ms; stable 60 FPS during fights.  

---

## ✅ Definition of Done (DoD)
- Dusk Wood biome fully procedural from entrance shrine to exit shrine.  
- At least 8 reusable templates tagged and validated for PCG.  
- Biome visuals (tiles, parallax, fog, LUT, SFX) applied correctly per seed.  
- Wolf variants functioning; White Wolf elite fight implemented with destructible trunks.  
- Shrine transitions working: Lost Glades → Dusk Wood → Castle Prison.  
- Death loop functional: respawn at last shrine, biome regenerates with new seed.  
- 60 FPS stable, no console errors.  

---

## 🔮 Long-Term Extensions
- Expand template pool to 12–15 for greater replay variety.  
- Add unique hazards (falling logs, collapsing bridges).  
- Introduce rare “aberrant” wolf variants (future Aberration System).  
- Seed replay mode for testing/“Daily Runs.”  

---

# Phase 4 — Act II (Castle Prison: Bat Swarms + Skeleton Warriors + Key Puzzle) (Week 4)

## 🎯 Goals
- Deliver the **second full procedural biome**: Castle Prison.  
- Introduce **Bat Swarms** (aerial crowd threat) and **Skeleton Warriors** (sword + axe variants).  
- Implement a **key-gate puzzle** (3 bells → Jailor room → Crypt Key).  
- Establish a **branching path structure**: Castle Prison → Blood Mansion OR optional Fallen Knight duel.  
- Ensure combat and traversal feel tense, claustrophobic, and distinct from Dusk Wood.

---

## 🗂️ Scope Overview
Castle Prison marks Act II’s start, introducing **denser enemy encounters** and the game’s first **puzzle mechanic**.  

- Rooms are procedurally arranged per seed, maintaining an entrance → puzzle/key room → exit → shrine flow.  
- Bat swarms escalate vertical threat and crowd management.  
- Skeleton Warriors add melee variety with distinct tells and punish windows.  
- The puzzle provides narrative and mechanical pacing before opening the way deeper into Act II.

Flow:  
**Shrine (entry from Dusk Wood) → procedural Castle Prison rooms → Puzzle room (Crypt Key) → Jailor fight → exit shrine → Blood Mansion (and optional Fallen Knight path).**

---

## 📦 Core Deliverables
- ✅ 10+ Castle Prison room templates (combat, traversal, fork, puzzle candidate, elite).  
- ✅ BiomeConfig (tileset: stone walls, LUT: cold/grey, SFX: distant chains, moans, iron clanging).  
- ✅ Bat Swarm AI: 4–5 bats in clusters, pooled and leashed.  
- ✅ Skeleton Warrior variants:  
  - **Sword:** combo-oriented melee, thrust gap-closer.  
  - **Axe:** cleave + overhead slam, creates ground FX.  
- ✅ Puzzle system: 3 bell strike in 5s → opens portcullis → Jailor fight → Crypt Key.  
- ✅ Optional secret door (sigil flicker wall) → Fallen Knight duel path.  
- ✅ Inter-biome shrine exit: transitions to Blood Mansion.  

---

## 🛠️ Key Systems to Implement

### 1. Castle Prison Room Templates
- Author 10+ templates:  
  - **Combat rooms:** narrow corridors, choke points, vertical shafts.  
  - **Traversal rooms:** platforms with iron grates, ladders, spike pits.  
  - **Puzzle candidate:** large chamber with 3 bells positioned at different heights.  
  - **Elite arena:** Jailor fight (Skeleton Axe variant).  
  - **Secret room candidates:** sigil walls with faint flicker.  
- Tag templates for PCG selection: combat-heavy, puzzle_required, elite_arena, secret_candidate.

### 2. BiomeConfig
- **Visuals:**  
  - Tile set: stone prison blocks, barred cells.  
  - Parallax stack: BG3 iron gates → BG2 chains → BG1 walls.  
  - LUT: desaturated cold grey-blue.  
  - Fog: dense, low-lying mist.  
- **Audio:**  
  - Ambient: dripping water, rattling chains.  
  - Layered SFX: prisoner groans, cell doors slamming in distance.  
- **Spawns:**  
  - Common: Bat Swarms, Skeleton Sword.  
  - Uncommon: Skeleton Axe.  
  - Elite: Jailor (guaranteed).  

### 3. Bat Swarm AI
- Clustered group behavior (4–5 bats).  
- Shared **aggro trigger**: once one bat detects the hero, entire swarm activates.  
- Dive cadence offset so they don’t “shotgun” simultaneously.  
- Pooled for performance (reuse instances).  
- Leash to ceiling anchor (max radius 10–12 tiles).  

### 4. Skeleton Warrior AI
- **Sword Variant**:  
  - 2–3 hit light string.  
  - Thrust gap-closer with punishable recovery.  
- **Axe Variant**:  
  - Cleave attack (wide arc).  
  - Overhead slam (ground impact FX + small stun window).  
- Shared rules:  
  - Distinct shoulder/hip tells.  
  - Strict but fair punish windows.  

### 5. Puzzle System (Crypt Key)
- Room contains 3 bells in different vertical positions.  
- Player must strike all 3 within 5s.  
- Success: portcullis opens → Jailor fight arena.  
- Jailor (Skeleton Axe elite variant) drops **Crypt Key**.  
- Key unlocks portcullis to continue deeper into Castle → Blood Mansion.  

### 6. Optional Secret Path
- Sigil wall flickers faintly when nearby.  
- Requires Crypt Key to open.  
- Leads to optional Fallen Knight duel path.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Implement swarm pooling | Bat AI optimized for 4–5 instances at once |
| Add bell prefab | Trigger collision + visual/audio FX |
| Portcullis prefab | Opens after bell puzzle success |
| Jailor boss tuning | Axe variant buffed (HP + dmg) |
| Sigil wall prefab | Breakable only with Crypt Key |
| Reward handling | Crypt Key stored in RunData |

---

## 🧪 Testing
- **PCG seed tests:** 20 seeds → ensure puzzle room always spawns, path valid.  
- **Bat swarm tests:** swarms aggro together but never dive simultaneously; FPS stable (>55).  
- **Skeleton test:** sword variant thrust is iframe-punishable; axe slam FX appears on ground.  
- **Puzzle test:** striking bells within 5s → portcullis opens correctly.  
- **Secret door test:** sigil wall only opens with Crypt Key.  
- **Death loop:** dying mid-biome → respawn at shrine (Dusk Wood exit) → fresh Castle Prison seed generated.  

---

## ✅ Definition of Done (DoD)
- Castle Prison generates procedurally per seed with puzzle + elite room guaranteed.  
- Biome visuals (tileset, LUT, fog, parallax, ambient) applied correctly.  
- Bat Swarm AI works: clustered aggro, offset dives, pooled for performance.  
- Skeleton Sword and Axe implemented with distinct tells and punish windows.  
- Puzzle room functional: 3 bells within 5s opens portcullis → Jailor fight.  
- Crypt Key drops correctly; unlocks portcullis and optional Fallen Knight path.  
- Exit shrine transitions to Blood Mansion.  
- Performance: stable 60 FPS during swarms + puzzle rooms.  
- No console errors, no softlocks.  

---

## 🔮 Long-Term Extensions
- Add **skeleton mage variant** (projectile, zoning).  
- Extend puzzle variety (rotating levers, chained switches).  
- Introduce rare aberrant bat swarm (larger, corrupted variant).  
- Add lore tablets in prison cells for environmental storytelling.  

---

# Phase 5 — Optional Duel & Mid-Boss (Fallen Knight + Blood Mansion + Skeleton King) (Week 5)

## 🎯 Goals
- Deliver the **first optional duel boss** (Fallen Knight), branching from Castle Prison.  
- Build out the **Blood Mansion biome** with unique hazards and traversal quirks.  
- Implement the **Skeleton King mid-boss fight**, gating Act II’s completion.  
- Polish the **boss UI** (nameplate, theme layering, music shifts).  
- Introduce permanent progression rewards via relics and flask upgrades.  

---

## 🗂️ Scope Overview
This phase combines an optional high-skill duel encounter with a required mid-boss gate:  

- The **Fallen Knight** is an optional duel, accessed via the Castle Prison sigil wall. He tests mastery of the core combat systems with aggressive combos.  
- The **Blood Mansion** is the next PCG biome, smaller but filled with environmental hazards (chandeliers, turret statues).  
- The **Skeleton King** serves as Act II’s boss wall, fought in a large arena with multi-phase mechanics and summoning patterns.  

Biome progression:  
**Shrine (Castle Prison exit) → Blood Mansion procedural rooms → Skeleton King arena → exit shrine → Deadwind Pass.**  
Optional: **Sigil wall → Fallen Knight duel → relic reward → return to Blood Mansion path.**

---

## 📦 Core Deliverables
- ✅ 6–8 Blood Mansion room templates (combat, traversal, chandelier hazard, secret).  
- ✅ BiomeConfig (Blood Mansion visuals, LUTs, parallax, ambient SFX).  
- ✅ Fallen Knight duel encounter (optional, Crypt Key gated).  
- ✅ Skeleton King multi-phase boss fight (mandatory).  
- ✅ Boss UI (nameplate, music layering).  
- ✅ Rewards: Broken Vow relic (Fallen Knight), Throne Seal relic + flask upgrade (Skeleton King).  
- ✅ Shrine transitions: Castle Prison → Blood Mansion → Deadwind Pass.  

---

## 🛠️ Key Systems to Implement

### 1. Blood Mansion Room Templates
- Author 6–8 templates:  
  - **Combat rooms:** long corridors, balconies with ambush angles.  
  - **Traversal:** vertical staircases, trap rooms.  
  - **Hazards:** chandeliers (rope cut triggers falling object), turret statues firing bolts.  
  - **Secret candidates:** breakable wall into relic chest.  
- Tagged for PCG: combat-heavy, hazard, traversal, secret.  
- Arena exit always leads to Skeleton King fight.  

### 2. BiomeConfig
- **Visuals:**  
  - Tile set: gothic architecture, red drapery.  
  - Parallax: stained glass → chandeliers → grand hall.  
  - LUT: warm gold + blood red tones.  
  - Fog: faint smoky haze.  
- **Audio:**  
  - Ambient: wind through halls, distant creaks.  
  - Environmental SFX: chandeliers swaying, statues groaning.  
- **Spawns:**  
  - Common: Skeleton Sword.  
  - Uncommon: Skeleton Axe.  
  - Rare: Bat swarm (roosting in rafters).  
  - Elite: Skeleton King (guaranteed arena).  

### 3. Fallen Knight Duel (Optional)
- **Access:** sigil wall in Castle Prison → opens only with Crypt Key.  
- **Arena:** tight dueling chamber, no hazards.  
- **AI Phases:**  
  - **P1:** standard sword combos (2–3 string), occasional heavy thrust.  
  - **P2 (≤50% HP):** “Madness” mode: faster recovery, feints, relentless pressure.  
- **Rules:** flask punishable during fight.  
- **Reward:** Broken Vow relic (+20ms perfect-roll grace).  

### 4. Skeleton King Boss (Required)
- **Arena:** large throne room with destructible props.  
- **AI Phases:**  
  - **P1:** cleave, bash, thrust.  
  - **P2 (≤50% HP):** skeleton summons (2 minions), chandelier drop gimmick (player can cut chains).  
- **Boss UI:**  
  - Nameplate with HP bar.  
  - Music layering: choir intensifies in P2.  
- **Rewards:** Throne Seal relic + +1 flask slot.  
- **Exit:** shrine spawns after victory → transition to Deadwind Pass.  

### 5. Boss UI & Theme Layering
- Unique **boss nameplate** overlay with fade-in.  
- Dynamic music layering (add organ/choir layers on phase change).  
- Boss intro cut-in (short animation, camera zoom).  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Implement chandelier hazard prefab | Break chain = falls with dust/smash FX |
| Add turret statue prefab | Fires bolts on player LOS |
| Skeleton King summon logic | Minions obey leash radius |
| Music layering system | Boss fight tracks with dynamic layering |
| Relic inventory handling | Broken Vow & Throne Seal saved to RunData |
| Shrine FX | Transition shrine after Skeleton King fight |

---

## 🧪 Testing
- **PCG seed tests:** 20 runs → Blood Mansion always valid, Skeleton King arena reachable.  
- **Fallen Knight test:** duel accessible only via Crypt Key; P2 triggers at ≤50% HP; relic reward drops reliably.  
- **Skeleton King test:** chandelier drops work, minion summons functional, choir layer fades in correctly.  
- **Death loop:** dying in Blood Mansion → respawn at Castle Prison shrine → fresh seed generated.  
- **Boss loop:** dying to Skeleton King → respawn at Blood Mansion entry shrine → boss arena regenerated.  
- **Performance:** chandelier and turret hazards never dip FPS below 55.  

---

## ✅ Definition of Done (DoD)
- Blood Mansion biome fully procedural with 6–8 templates.  
- Fallen Knight duel implemented, optional but rewarding.  
- Skeleton King multi-phase fight implemented, gating Act II’s completion.  
- Boss UI and dynamic music layering functional.  
- Relics (Broken Vow, Throne Seal) saved to RunData.  
- Exit shrine transitions to Deadwind Pass after Skeleton King victory.  
- Stable 60 FPS, no console errors.  

---

## 🔮 Long-Term Extensions
- Add **rare aberrant Skeleton variant** (future Aberration System).  
- Expand Blood Mansion hazards (falling debris, cursed flames).  
- Add alternative Fallen Knight dialogue paths (NG+).  
- Implement cinematic intro cutscenes for bosses.  

---

# Phase 6 — Act III Part 1 (Deadwind Pass + Spectral Variants + Ghost Warrior 3) (Week 6)

## 🎯 Goals
- Deliver the **Deadwind Pass biome**, focused on traversal challenges and spectral enemies.  
- Introduce new environmental hazard: **wind volumes** that alter jump arcs.  
- Add **Spectral Wolf** variant and the **Ghost Warrior elite** enemy.  
- Create a **branching path structure**: Oculus Key branch vs. small arena alternative.  
- Establish the midpoint of Act III, ramping up difficulty and atmosphere before the Cemetery finale.

---

## 🗂️ Scope Overview
Deadwind Pass is designed as a high-tension traversal biome with supernatural atmosphere.  

- The environment itself becomes hostile through **wind volumes** that push/pull the hero mid-air.  
- **Spectral enemies** escalate familiar threats with buffs and eerie visual effects.  
- The **Ghost Warrior 3** introduces a new high-skill elite encounter with teleportation and combo strings.  
- A branching structure ensures replay variety: the hero must acquire the **Oculus Key** via platforming or by winning a combat arena alternative.  

Biome flow:  
**Shrine (Blood Mansion exit) → Deadwind Pass procedural rooms → Oculus Key branch (platforming or arena) → exit shrine → Forgotten Cemetery.**

---

## 📦 Core Deliverables
- ✅ 8–10 Deadwind Pass room templates (platforming, traversal with wind, elite arena, branch path).  
- ✅ BiomeConfig (Deadwind visuals, LUTs, fog, audio).  
- ✅ Wind volume system (affects physics/jumps).  
- ✅ Spectral Wolf variant (buffed Grey Wolf).  
- ✅ Ghost Warrior elite fight.  
- ✅ Oculus Key branch logic (platforming challenge OR combat arena alternative).  
- ✅ Exit shrine → Forgotten Cemetery.  

---

## 🛠️ Key Systems to Implement

### 1. Deadwind Pass Room Templates
- Author 8–10 templates:  
  - **Platforming rooms**: high platforms, moving jumps, wind volumes.  
  - **Traversal rooms**: narrow ledges, collapsing bridges.  
  - **Elite arena**: Ghost Warrior fight.  
  - **Branch rooms**: one leading to Oculus Key platforming challenge, one to small arena alternative.  
- Tag templates for traversal-heavy vs. combat-heavy paths.  

### 2. BiomeConfig
- **Visuals:**  
  - Tileset: cliffs, ruins, and broken towers.  
  - Parallax: storm clouds, ghostly silhouettes, broken bridges.  
  - LUT: desaturated blue/grey with flickering lightning accents.  
  - Fog: strong directional mist.  
- **Audio:**  
  - Ambient: wind howls, occasional thunder.  
  - Layered SFX: spectral whispers, distant screams.  
- **Spawns:**  
  - Common: Spectral Wolves.  
  - Rare: Bat swarm (corrupted).  
  - Elite: Ghost Warrior (guaranteed).  

### 3. Wind Volumes
- **Mechanics:**  
  - Invisible zones with directional push (up/down/side).  
  - Apply constant force to hero mid-air.  
  - Visual FX: drifting particles show wind direction.  
- **Tuning:**  
  - Strong enough to alter trajectory, but not unfair.  
  - Coyote time + input buffering preserved.  

### 4. Spectral Wolf Variant
- **Visuals:** shader tint (blue/white glow).  
- **Stats:** small buff to speed and damage.  
- **AI:** same skeleton as regular Wolf.  
- **Audio:** distorted howls, ghostly echo.  

### 5. Ghost Warrior Elite
- **Arena:** circular platform, wind volumes around edges.  
- **Moveset:**  
  - Blink teleport (short/step-in/long).  
  - Multi-hit sword strings.  
  - Afterimage FX on blink/attacks.  
  - Counter windows: readable cloak flare + hum.  
- **Phases:**  
  - **P1:** 2–3 hit strings, short blinks.  
  - **P2 (≤50% HP):** long blinks, 5-hit string, delayed feints.  
- **Reward:** Oculus Key (if fought in arena path).  

### 6. Oculus Key Branch
- **Option A (platforming path):**  
  - Vertical gauntlet of moving platforms + wind volumes.  
  - Key placed at top platform.  
- **Option B (arena path):**  
  - Small combat chamber; defeat Ghost Warrior → drop Oculus Key.  
- **Logic:** one path always accessible; player choice drives variety.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Implement wind volume prefab | Area zones with directional force + particle FX |
| Add collapsing bridge prefab | Crumbles after 2–3s of standing |
| Add spectral wolf shader | Blue tint + glow |
| Ghost Warrior afterimage FX | Layered alpha silhouettes |
| Oculus Key prefab | Glowing pickup, saved to RunData |
| Shrine transition logic | Exit shrine → Forgotten Cemetery |

---

## 🧪 Testing
- **PCG seed tests:** 20 runs → branch logic always produces valid Oculus Key path.  
- **Wind test:** volumes alter trajectory fairly; coyote time preserved.  
- **Spectral wolf test:** spawns correctly, stats buffed.  
- **Ghost Warrior test:** blinks readable; P2 triggers at ≤50% HP; arena winds don’t break fairness.  
- **Key logic test:** key always obtainable via platforming OR arena.  
- **Death loop:** dying mid-biome → respawn at Blood Mansion exit shrine → fresh seed generated.  
- **Performance:** wind volumes and afterimage FX don’t dip FPS under 55.  

---

## ✅ Definition of Done (DoD)
- Deadwind Pass biome procedural with 8–10 templates, valid branch path guaranteed.  
- Biome visuals/audio working: storm, fog, whispers.  
- Wind volumes functional, fair, and readable.  
- Spectral Wolves working with shader + stat buffs.  
- Ghost Warrior elite implemented with blink + afterimage moveset.  
- Oculus Key always obtainable; stored in RunData.  
- Exit shrine transitions cleanly to Forgotten Cemetery.  
- Stable 60 FPS, no console errors.  

---

## 🔮 Long-Term Extensions
- Add **Spectral Bat variant** (splits on death).  
- Expand wind mechanics (gusts that pulse instead of constant).  
- Add lore tied to Oculus Key (ritual text, NPC whispers).  
- Introduce rare aberrant Ghost Warrior (future Aberration System).  

---

# Phase 7 — Act III Part 2 (Forgotten Cemetery + Final Boss + Endings + Balance Pass 1) (Week 7)

## 🎯 Goals
- Deliver the **Forgotten Cemetery biome**, a short but climactic zone leading into the final boss.  
- Implement the **Angel of Death multi-phase fight** (P1–P3).  
- Create **ending choice logic** at the final shrine (Absolution vs. Taken).  
- Add **first NG+ flagging system** to enable future replayability scaling.  
- Conduct a **first global balance pass** (enemy stats, flask timings, roll windows, music mix).

---

## 🗂️ Scope Overview
The Forgotten Cemetery is the final atmospheric run before the endgame. It serves as the **player’s last trial**: eerie traversal, lingering spectral enemies, and the ominous Angel Arena at the end.  

- **Biome:** short, high-tension PCG zone (4–6 templates).  
- **Angel of Death:** three distinct boss phases, escalating visually and mechanically.  
- **Endings:** shrine prompt before the arena offers choice (Absolution vs. Taken).  
- **NG+ system:** flags set at ending, carrying progression forward.  
- **Balance pass:** tighten combat timings, adjust enemy stats, and complete first audio mix.  

Biome flow:  
**Shrine (Deadwind Pass exit) → Forgotten Cemetery procedural rooms → Ending shrine → Angel of Death Arena → Credits + NG+ toggle.**

---

## 📦 Core Deliverables
- ✅ 4–6 Forgotten Cemetery room templates (combat, traversal, tomb hazards).  
- ✅ BiomeConfig (Cemetery visuals, LUTs, fog, ambient audio).  
- ✅ Angel of Death boss fight with 3 escalating phases.  
- ✅ Ending choice shrine logic (Absolution vs. Taken).  
- ✅ NG+ flagging system in RunData.  
- ✅ First balance pass (stats, timings, mix).  

---

## 🛠️ Key Systems to Implement

### 1. Cemetery Room Templates
- Author 4–6 templates:  
  - **Combat rooms:** skeletal ambushes, spectral variants.  
  - **Traversal rooms:** crumbling mausoleums, uneven gravestones.  
  - **Hazards:** collapsing crypt tiles, bone spikes.  
- Small biome; PCG ensures variation without extending length unfairly.  
- Exit always routes to Angel Arena.  

### 2. BiomeConfig
- **Visuals:**  
  - Tileset: broken graves, cracked statues.  
  - Parallax: fog layers, silhouettes of monuments.  
  - LUT: green-grey desaturation, heavy vignette.  
  - Fog: thick rolling mist.  
- **Audio:**  
  - Ambient: distant church bells, faint chants.  
  - Random SFX: rattling bones, whispers.  
- **Spawns:**  
  - Common: Skeleton Sword/Axe.  
  - Rare: Spectral Wolves.  
  - Elite: none (focus shifts to boss).  

### 3. Angel of Death Boss
- **Arena:** vast graveyard plateau with shifting fog.  
- **Phases:**  
  - **P1 (100–66% HP):** scythe sweeps, feather fan projectiles, short blink teleports.  
  - **P2 (65–33% HP):** dive reap, Ring of Wails (AOE pulse), wind intensifies.  
  - **P3 (≤33% HP):** Black Halo blades (circular summons), long blinks with afterimage feints, 8-direction bolt attacks.  
- **Telegraphs:** cloak flares, wing beats, audio cues.  
- **Counter windows:** only grounded reaps punishable.  
- **FX:** phase shifts with escalating choir/organ layers.  
- **Rewards:** triggers ending cutscene; no relic drop (finale).  

### 4. Ending Choice Shrine
- Located just before Angel Arena.  
- Offers player a choice:  
  - **Absolution:** “clean” ending path.  
  - **Taken:** darker ending path.  
- Choice logged in RunData for NG+.  

### 5. NG+ System
- At ending: set NG+ flag in RunData = true.  
- On next run: enemies scale (HP, dmg), altered seed modifiers available.  
- Title screen displays NG+ indicator.  

### 6. Balance Pass 1
- Review enemy stats across all biomes.  
- Tighten flask sip timings (cancel windows).  
- Verify perfect-roll window = 120 ms.  
- Adjust boss punish windows for fairness.  
- Mix pass:  
  - Duck SFX during music climaxes.  
  - Angel fight adds organ/choir layers on P2/P3.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Add collapsing crypt prefab | Breaks after brief stand |
| Add bone spike prefab | Pops up on trigger |
| Boss UI expansion | Angel’s unique nameplate + wing motif |
| Ending shrine FX | Bright vs. dark aura depending on choice |
| RunData save hook | NG+ flag, ending choice |
| Credits stub | Auto-roll after ending cutscene |

---

## 🧪 Testing
- **PCG seed tests:** 10 runs → Cemetery always valid, 4–6 rooms before arena.  
- **Boss test:** Angel phase shifts trigger at correct HP thresholds; telegraphs readable; choir/organ layers add properly.  
- **Ending test:** shrine choice records correctly; cutscenes trigger as expected.  
- **NG+ test:** after ending, title screen shows NG+ flag; enemies buffed on next run.  
- **Balance test:** perfect-roll window consistent at 120 ms; flask cancel window functional.  
- **Performance:** Angel arena stable 60 FPS even during P3 with FX density.  

---

## ✅ Definition of Done (DoD)
- Forgotten Cemetery biome implemented with 4–6 procedural templates.  
- Angel of Death boss fight complete with 3 escalating phases.  
- Ending shrine choice functional; Absolution vs. Taken logged in RunData.  
- NG+ flagging system works; title shows NG+ after first completion.  
- Balance pass applied across combat engine, flask timings, roll windows.  
- Boss UI polished, music layering works, FX stable.  
- Stable 60 FPS, no console errors, no softlocks.  

---

## 🔮 Long-Term Extensions
- Expand Cemetery templates to 8–10 for NG+ variety.  
- Add rare aberrant spawns (future Aberration System).  
- Alternate endings for NG++ runs.  
- Cinematic intro for Angel fight with environmental destruction.  

---

# Phase 8 — Polish, Accessibility, Optimization, Release Candidate (Week 8)

## 🎯 Goals
- Deliver a stable **Release Candidate build** of the game.  
- Polish combat feel, inputs, FX, and performance across all biomes.  
- Implement **accessibility features** (visual/auditory toggles, color-blind palettes, remap polish).  
- Optimize assets and runtime to ensure **stable 60 FPS** across mid-range hardware.  
- Conduct final QA passes with checklists, telemetry validation, and balance tuning.  
- Prepare for deployment as a static web build.  

---

## 🗂️ Scope Overview
This phase is about turning a functional v1 into a **shippable product**.  

- **Polish:** finalize animations, combat transitions, post-processing, and encounter tuning.  
- **Accessibility:** add player-facing options for flashes, shake, color palettes, and audio readability.  
- **Optimization:** texture compression, sprite pooling, particle throttling.  
- **Release Candidate:** GitHub Pages / Netlify / Cloudflare deployment with credits, favicon, and a QA-ready build.  

---

## 📦 Core Deliverables
- ✅ Global polish pass (combat, animations, transitions, post-FX).  
- ✅ Accessibility settings (flashes, shake, palettes, subtitles, remaps).  
- ✅ Optimized assets (textures, sprites, audio).  
- ✅ QA checklist completion across all biomes and bosses.  
- ✅ Telemetry validation for all run events.  
- ✅ Static build deployment + credits.  

---

## 🛠️ Key Systems to Implement

### 1. Combat & Input Polish
- Refine combat transitions (attack → roll → recovery) for flow.  
- Finalize animation timings across enemies to remove stutter/jank.  
- Add subtle hitstop tuning for light/heavy hits.  
- Adjust stamina regen curve for fairness.  
- Confirm dodge i-frames align with animation windows.  

### 2. Post-Processing & FX Tuning
- Biome-specific LUTs finalized (forest green, prison grey-blue, mansion red-gold, pass storm-grey, cemetery desaturated).  
- Bloom reserved for stained glass / magical FX (avoid overuse).  
- Sanity vignette tuned to pulse intensity without obstructing readability.  
- White flash shader intensity capped at accessibility-friendly levels.  

### 3. Accessibility Options
- **Flashes:** toggle Off / Minimal / Normal.  
- **Screen shake:** toggle Off / Low / Normal.  
- **Color-blind palettes:** protanopia, deuteranopia, tritanopia.  
- **Subtitles:** on by default for all story/NPC dialogue.  
- **Remap UI:** polish placeholder bindings into full rebinding screen.  

### 4. Optimization Pipeline
- **Textures:** atlas trimming, oxipng/zopfli compression.  
- **Sprites:** pooled and reused (FX, enemies, props).  
- **Particles:** throttle under 55 FPS (auto-despawn extras).  
- **Audio:** convert to OGG 160 kbps VBR.  
- **Runtime:** clamp frame delta (≤1/30s) to prevent physics spikes.  

### 5. QA & Telemetry
- Run encounter checklist across all biomes (wolves, bats, skeletons, Ghost Warrior, Angel).  
- Confirm all shrines work as inter-biome transitions.  
- Telemetry events validated:  
  - `biome_seed_start`  
  - `biome_failed`  
  - `biome_complete`  
  - `biome_transition`  
  - `boss_start/phase_change/death`  
- Verify relics, keys, and NG+ flags persist properly.  
- NG+ scaling tested (enemy buffs applied).  

### 6. Deployment
- Prepare final static build via GitHub Pages / Netlify / Cloudflare Pages.  
- Add `credits.html` (contributors, tools, asset licenses).  
- Add favicon + metadata.  
- Internal patch notes + “How to Test” guide for QA.  

---

## 📋 Supporting Tasks
| Task | Notes |
|------|-------|
| Final relic inventory screen | Show collected relics post-run |
| Audio mix pass | Balance SFX/music ducking, boss choir layering |
| Credits stub | List all libraries, tools, inspirations |
| LocalStorage reset tool | QA can clear save easily |
| Performance monitor | FPS + draw call overlay in debug |

---

## 🧪 Testing
- **Perf test:** Stress-test biomes with swarms + FX → FPS ≥ 55.  
- **Accessibility test:** Toggle flashes, shake, palettes → settings apply immediately.  
- **Combat test:** Combo → roll → heavy → roll cancel → feels snappy, no jank.  
- **Boss test:** All bosses reset cleanly on death, no softlocks.  
- **NG+ test:** Complete run, restart → NG+ active, buffs applied.  
- **Deployment test:** Open build in fresh browser profile → no errors, stable FPS.  

---

## ✅ Definition of Done (DoD)
- Combat flow smooth, no stutters or animation jitters.  
- All accessibility settings functional and player-facing.  
- Textures/audio optimized, FPS stable at 60 in normal play.  
- Telemetry logs all major events accurately.  
- QA checklist complete across all biomes/bosses.  
- Release Candidate deployed, credits page live.  
- No console errors, no critical bugs.  

---

## 🔮 Long-Term Extensions
- Add meta-progression hub (shrines offering permanent upgrades).  
- Daily Seed mode with leaderboard.  
- Speedrun timer overlay.  
- Expanded accessibility suite (font scaling, audio EQ).  
- Console/browser porting optimizations.  

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
