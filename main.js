// Echoes of the Ruin — Phase 2.3.1
// Fix: non-looping anims sticking; clean Parry(tap E) + Block(hold E)
// Uses global BABYLON from CDN (no tooling)

(() => {
  // ====== Tunables / Fallbacks ======
  const PPU = 32;                       // pixels per world unit
  const FALLBACK_BASELINE_PX = 6;       // if pixel-read fails
  const ORTHO_VIEW_HEIGHT = 12;         // vertical world units in view
  const PARRY_WINDOW_MS = 120;          // parry window + parry anim duration
  const HOLD_THRESHOLD_MS = 180;        // how long E must be held to count as Block (not Parry)
  const LANDING_MIN_GROUNDED_MS = 45;   // delay landing anim until on-ground persisted briefly
  const LANDING_SPAM_GRACE_MS = 160;    // suppress landing anim if jump pressed again within this window
  const HERO_TORSO_FRAC = 0.58;         // relative height (feet->head) where torso FX center should sit

  // Ensure CSS (fallback if external fails)
  (function ensureCss() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles.css?v=16';
    link.onerror = () => {
      const style = document.createElement('style');
      style.textContent = `
        html,body{height:100%;margin:0;background:#000}
        #game-canvas{width:100vw;height:100vh;display:block;image-rendering:pixelated;image-rendering:crisp-edges}
      `;
      document.head.appendChild(style);
      console.warn('styles.css not found; injected minimal fallback CSS.');
    };
    document.head.appendChild(link);
  })();

  // ---- Helpers ----
  function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ok: true, img, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ ok: false, img: null, w: 0, h: 0 });
      img.src = url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(); // bust cache while iterating
    });
  }

  // Scan bottom-most opaque pixel across all frames to compute baseline (empty rows below feet)
  async function detectBaselinePx(image, sheetW, sheetH, frames, frameW, frameH) {
    try {
      const c = document.createElement('canvas');
      c.width = sheetW; c.height = sheetH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, sheetW, sheetH);
      ctx.drawImage(image, 0, 0);

      const data = ctx.getImageData(0, 0, sheetW, sheetH).data;
      let maxBottomOpaqueY = -1;

      for (let f = 0; f < frames; f++) {
        const x0 = f * frameW;
        for (let y = frameH - 1; y >= 0; y--) {
          let found = false;
          const rowOffset = (y * sheetW + x0) * 4;
          for (let x = 0; x < frameW; x++) {
            const idx = rowOffset + x * 4;
            if (data[idx + 3] !== 0) { // non-transparent
              maxBottomOpaqueY = Math.max(maxBottomOpaqueY, y);
              found = true; break;
            }
          }
          if (found) break;
        }
      }
      if (maxBottomOpaqueY < 0) return FALLBACK_BASELINE_PX;
      return (frameH - 1) - maxBottomOpaqueY;
    } catch {
      return FALLBACK_BASELINE_PX;
    }
  }

  try {
    // --- Babylon boot ---
    const canvas = document.getElementById('game-canvas');
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
    const glow = new BABYLON.GlowLayer('glow', scene);
    glow.intensity = 0.6;

    // ---- WebAudio ----
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // ===== ORTHOGRAPHIC CAMERA =====
    const camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 2, -8), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1, 0));
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    function fitOrtho() {
      const aspect = engine.getRenderWidth() / engine.getRenderHeight();
      const top = ORTHO_VIEW_HEIGHT / 2;
      const right = top * aspect;
      camera.orthoTop = top; camera.orthoBottom = -top;
      camera.orthoLeft = -right; camera.orthoRight = right;
    }
    fitOrtho();

    // Light
    new BABYLON.HemisphericLight('sun', new BABYLON.Vector3(0, 1, 0), scene);

    // Ground
    const ground = BABYLON.MeshBuilder.CreateGround('g', { width: 50, height: 8 }, scene);
    ground.position.y = 0;
    const gmat = new BABYLON.StandardMaterial('gmat', scene);
    gmat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.12);
    gmat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = gmat;

    // Placeholder (drives physics)
    const placeholder = BABYLON.MeshBuilder.CreateBox('playerBox', { size: 1.5 }, scene);
    placeholder.position.set(0, 0.75, 0);
    const pmat = new BABYLON.StandardMaterial('pmat', scene);
    pmat.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.95);
    placeholder.material = pmat;

    // Contact shadow
    const shadow = BABYLON.MeshBuilder.CreateDisc('shadow', { radius: 0.3, tessellation: 24 }, scene);
    shadow.rotation.x = Math.PI / 2.3;
    shadow.position.y = 0.01;
    const smat = new BABYLON.StandardMaterial('smat', scene);
    smat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    smat.emissiveColor = new BABYLON.Color3(0, 0, 0);
    smat.specularColor = new BABYLON.Color3(0, 0, 0);
    smat.alpha = 0.35; shadow.material = smat;

    // World objects
    const ladders = [];
    const shrines = [];
    const campfireMeta = { url: 'assets/sprites/Campfire/CampFire.png', frames: 5, fps: 8 };
    let campfireMgr = null;
    let campfireSizeUnits = 1;
    const respawnKey = 'eotr_respawn';
    let respawn = JSON.parse(localStorage.getItem(respawnKey) || 'null');
    if (respawn) {
      placeholder.position.x = respawn.x;
      placeholder.position.y = respawn.y;
    } else {
      respawn = { x: placeholder.position.x, y: placeholder.position.y };
    }
    function createLadder(x, y0, y1, width = 0.5) {
      const h = y1 - y0;
      const mesh = BABYLON.MeshBuilder.CreateBox('ladder', { width, height: h, depth: 0.2 }, scene);
      mesh.position.set(x, y0 + h * 0.5, 0);
      mesh.isVisible = false;
      ladders.push({ x, y0, y1, width, mesh });
      return ladders[ladders.length - 1];
    }
    async function spawnShrine(x, y) {
      const mesh = BABYLON.MeshBuilder.CreateCylinder('shrine', { height: 1.5, diameter: 0.5 }, scene);
      mesh.position.set(x, y + 0.75, 0);
      mesh.isVisible = false;

      if (!campfireMgr) {
        const { ok, w: sheetW, h: sheetH } = await loadImage(campfireMeta.url);
        if (ok) {
          const frameW = Math.floor(sheetW / campfireMeta.frames);
          const frameH = sheetH;
          campfireSizeUnits = frameH / PPU;
          campfireMgr = new BABYLON.SpriteManager('campfireMgr', campfireMeta.url, 1, { width: frameW, height: frameH }, scene);
          campfireMgr.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
          campfireMgr.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
          campfireMgr.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        }
      }
      if (campfireMgr) {
        const sp = new BABYLON.Sprite('campfire', campfireMgr);
        const fireScale = 0.6;
        sp.size = campfireSizeUnits * fireScale;
        sp.position = new BABYLON.Vector3(x, y + sp.size * 0.5, 0);
        sp.playAnimation(0, campfireMeta.frames - 1, true, 1000 / (campfireMeta.fps || 8));
        sp.useAlphaForGlow = true;
        sp.color = new BABYLON.Color4(1, 1, 1, 1);

        const radii = [sp.size * 0.4, sp.size * 0.8, sp.size * 1.2];
        const alphas = [0.1, 0.05, 0.02];
        radii.forEach((r, i) => {
          const light = BABYLON.MeshBuilder.CreateDisc(`campLight${i}`, { radius: r, tessellation: 24 }, scene);
          light.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
          light.position.set(sp.position.x, sp.position.y, sp.position.z + i * 0.001);
          const lmat = new BABYLON.StandardMaterial(`campLightMat${i}`, scene);
          lmat.diffuseColor = new BABYLON.Color3(0, 0, 0);
          lmat.specularColor = new BABYLON.Color3(0, 0, 0);
          lmat.emissiveColor = new BABYLON.Color3(0.8, 0.4, 0.05);
          lmat.alpha = alphas[i];
          light.material = lmat;
        });
      }

      shrines.push({ x, y, mesh });
      return shrines[shrines.length - 1];
    }
    function activateShrine(s) {
      setHP(stats.hpMax);
      setST(stats.stamMax);
      setFlasks(stats.flaskMax);
      respawn = { x: s.x, y: placeholder.position.y };
      localStorage.setItem(respawnKey, JSON.stringify(respawn));
    }

    // === INPUTS ===
    const Keys = {
      left: false, right: false, jump: false, roll: false,
      light: false, heavy: false, flask: false, interact: false,
      runHold: false, up: false, down: false,
      debugHurt: false, debugDie: false
    };

    // Special handling for I (tap=parry, hold=block)
    let eIsDown = false;
    let blockTimer = null;

    const KeyMapDown = {
      'KeyA': 'left', 'ArrowLeft': 'left',
      'KeyD': 'right', 'ArrowRight': 'right',
      'Space': 'jump', 'KeyL': 'roll',
        'KeyJ': 'light', 'KeyK': 'heavy', 'KeyF': 'flask',
        'KeyE': 'interact',
        'KeyW': 'up', 'ArrowUp': 'up',
        'KeyS': 'down', 'ArrowDown': 'down',
        'F7': 'slowMo', 'F8': 'colliders', 'F9': 'overlay', 'F10': 'enemyDbg',
        'ShiftLeft': 'runHold', 'ShiftRight': 'runHold',
        'KeyH': 'debugHurt', 'KeyX': 'debugDie'
      };
      const KeyMapUp = {
      'KeyA': 'left', 'ArrowLeft': 'left',
      'KeyD': 'right', 'ArrowRight': 'right',
      'Space': 'jump', 'KeyL': 'roll',
      'KeyJ': 'light', 'KeyK': 'heavy', 'KeyF': 'flask',
      'KeyE': 'interact',
      'KeyW': 'up', 'ArrowUp': 'up',
      'KeyS': 'down', 'ArrowDown': 'down',
      'ShiftLeft': 'runHold', 'ShiftRight': 'runHold',
      'KeyH': 'debugHurt', 'KeyX': 'debugDie'
    };

    window.addEventListener('keydown', e => {
      if (e.code === 'KeyI') {
        if (!eIsDown) {
          eIsDown = true;
          // start a one-shot timer; if still held after threshold, enter block
          blockTimer = setTimeout(() => {
            if (eIsDown && !state.acting && !state.dead && !state.blocking) {
              startBlock();
            }
          }, HOLD_THRESHOLD_MS);
        }
        return;
      }
      const k = KeyMapDown[e.code];
      if (!k || e.repeat) return;
        if (k === 'overlay') toggleOverlay();
        else if (k === 'enemyDbg') toggleEnemyDebug();
        else if (k === 'slowMo') toggleSlowMo();
        else if (k === 'colliders') toggleColliders();
        else
          Keys[k] = true;
        if (k === 'jump') {
          const pressAt = performance.now();
          state.jumpBufferedAt = pressAt;
          state.lastJumpPressAt = pressAt;
        }
      });

    window.addEventListener('keyup', e => {
      if (e.code === 'KeyI') {
        eIsDown = false;
        if (blockTimer) { clearTimeout(blockTimer); blockTimer = null; }
        if (state.blocking) {
          stopBlock();
        } else {
          triggerParry(); // treat as a tap if block never engaged
        }
        return;
      }
      const k = KeyMapUp[e.code]; if (!k) return;
      Keys[k] = false;
    });

    // === STATS ===
    const stats = {
      hpMax: 100, hp: 100,
      stamMax: 100, stam: 100, stamRegenPerSec: 22,
      walkMax: 2.4, runMax: 3.3, accel: 12.0, decel: 14.0,
      jumpVel: 8, gravity: -20, climbSpeed: 2.5,
      coyoteTime: 0.12, inputBuffer: 0.12,
      rollDur: 0.35, rollSpeed: 6.0, iFrameStart: 0.10, iFrameEnd: 0.30, rollCost: 10,
      lightCost: 5, heavyCost: 18,
      flaskCount: 3, flaskHealPct: 0.55, flaskSip: 0.9, flaskRollCancel: 0.5, flaskLock: 0, flaskMax: 3
    };
    const state = {
      onGround: true, vy: 0, vx: 0, lastGrounded: performance.now(), jumpBufferedAt: -Infinity, lastJumpPressAt: -Infinity,
      rolling: false, rollT: 0, iFramed: false,
      acting: false, facing: 1, dead: false,
      flasking: false,
      flaskPhase: '',
      flaskStart: 0,
      flaskEndAt: 0,
      flaskHealApplied: false,
      flaskKneelDoneAt: 0,

      // New
      blocking: false,
      parryOpen: false,
      parryUntil: 0,
      climbing: false,
      landing: false,
      landingStartAt: 0,
      landingUntil: 0,
      landingTriggeredAt: 0
    };

    // === HUD refs ===
    const hpFill = document.querySelector('#hp .fill');
    const stFill = document.querySelector('#stamina .fill');
    const flaskPips = [...document.querySelectorAll('#flasks .pip')];
    const promptEl = document.getElementById('prompt');
    const fadeEl = document.getElementById('fade');
    const healScreenEl = document.getElementById('heal-screen');
    let healScreenTimer = null;
    function showPrompt(msg) { promptEl.textContent = msg; promptEl.style.display = 'block'; }
    function hidePrompt() { promptEl.style.display = 'none'; }
    function setHP(v) { stats.hp = Math.max(0, Math.min(stats.hpMax, v)); hpFill.style.width = (stats.hp / stats.hpMax * 100) + '%'; }
    function setST(v) { stats.stam = Math.max(0, Math.min(stats.stamMax, v)); stFill.style.width = (stats.stam / stats.stamMax * 100) + '%'; }
    function setFlasks(n) { stats.flaskCount = Math.max(0, Math.min(stats.flaskMax, n)); flaskPips.forEach((p, i) => p.classList.toggle('used', i >= stats.flaskCount)); }
    setHP(stats.hp); setST(stats.stam); setFlasks(stats.flaskCount);

    // === Sprite sheets ===
    const SHEETS = {
      idle:   { url: 'assets/sprites/player/Idle.png',   frames: 10, fps: 10, loop: true },
      walk:   { url: 'assets/sprites/player/Walk.png',   frames: 8,  fps: 12, loop: true },
      run:    { url: 'assets/sprites/player/Run.png',    frames: 8,  fps: 14, loop: true },
      roll:   { url: 'assets/sprites/player/Roll.png',   frames: 5,  fps: 18, loop: true },
      kneelDown: { url: 'assets/sprites/player/KneelDown.png', frames: 5, fps: 12, loop: false },
      kneelUp:   { url: 'assets/sprites/player/KneelUp.png',   frames: 5, fps: 12, loop: false },

      // Light combo
      light1: { url: 'assets/sprites/player/Light1.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'light2' },
      light2: { url: 'assets/sprites/player/Light2.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'light3' },
      light3: { url: 'assets/sprites/player/Light3.png', frames: 6,  fps: 16, loop: false, cancelFrac: 0.7, next: null },

      // Air & heavy
      jump:   { url: 'assets/sprites/player/Jump.png',   frames: 3,  fps: 16, loop: true },
      fall:   { url: 'assets/sprites/player/Fall.png',   frames: 3,  fps: 16, loop: true },
      landing: { url: 'assets/sprites/player/Landing.png', frames: 5,  fps: 16, loop: false },
      climbUp:   { url: 'assets/sprites/player/LadderUp.png',   frames: 7, fps: 12, loop: true },
      climbDown: { url: 'assets/sprites/player/LadderDown.png', frames: 7, fps: 12, loop: true },
      heavy:  { url: 'assets/sprites/player/Heavy.png',  frames: 6,  fps: 12, loop: false },

      // Hurt + Death
      hurt:   { url: 'assets/sprites/player/Hurt.png',   frames: 3,  fps: 14, loop: false },
      death:  { url: 'assets/sprites/player/Death.png',  frames: 14, fps: 12, loop: false },

      // Block + Parry
      block:  { url: 'assets/sprites/player/Block.png',  frames: 1,  fps: 1,       loop: true  },
      parry:  { url: 'assets/sprites/player/Parry.png',  frames: 2,  fps: 16.6667, loop: false } // 2f / 120ms
    };

    const playerSprite = {
      mgr: {},
      sizeByAnim: {},
      sprite: null,
      state: 'idle',
      sizeUnits: 2,
      baselineUnits: (FALLBACK_BASELINE_PX / PPU),
      animStarted: 0,
      animDurationMs: 0,
      loop: true
    };

    const HEAL_FX_META = { url: 'assets/sprites/Heal/heal.png', frames: 6, fps: 6.6667 };
    const healFx = { mgr: null, sprite: null, sizeUnits: 0, animStart: 0, animDuration: 0, frameH: 0 };

    // Attack/Action timing
    const combo = { stage: 0, endAt: 0, cancelAt: 0, queued: false };
    let actionEndAt = 0; // generic end time for non-combo actions (hurt, heavy, parry, death)

    async function createManagerAuto(metaKey, computeBaseline = false) {
      const meta = SHEETS[metaKey];
      const { ok, img, w: sheetW, h: sheetH } = await loadImage(meta.url);
      if (!ok) return { ok: false };

      // Infer grid (works for 10x1, 5x2, 1x1, etc.)
      let cols = Math.max(1, Math.round(sheetW / sheetH));
      cols = Math.min(cols, meta.frames);
      let rows = Math.max(1, Math.ceil(meta.frames / cols));
      const frameW = Math.floor(sheetW / cols);
      const frameH = Math.floor(sheetH / rows);

      // Height in world units from pixel height
      const sizeUnits = frameH / PPU;
      playerSprite.sizeByAnim[metaKey] = sizeUnits;

      // Baseline auto-detect (idle only)
      if (computeBaseline) {
        const baselinePx = await detectBaselinePx(img, sheetW, sheetH, meta.frames, frameW, frameH);
        playerSprite.baselineUnits = baselinePx / PPU;
        console.log(`[SpriteBaseline] detected baselinePx=${baselinePx} → baselineUnits=${playerSprite.baselineUnits.toFixed(3)}`);
      }

      const mgr = new BABYLON.SpriteManager('mgr_' + metaKey, meta.url, 1, { width: frameW, height: frameH }, scene);
      mgr.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
      mgr.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE; // avoid UV wrapping on odd sheets
      mgr.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;

      console.log(`[Sprite] ${metaKey}: sheet ${sheetW}x${sheetH}, frames=${meta.frames}, cell ${frameW}x${frameH}, sizeUnits=${sizeUnits.toFixed(2)}`);
      return { ok: true, mgr, frameW, frameH };
    }

    // Compute the center Y that puts FEET at ground (y=0)
    function feetCenterY() { return (playerSprite.sizeUnits * 0.5) - playerSprite.baselineUnits; }
    function torsoCenterY() {
      const size = playerSprite.sizeUnits;
      const centerY = placeholder.position.y;
      const feetY = centerY - (size * 0.5) + playerSprite.baselineUnits;
      return feetY + size * HERO_TORSO_FRAC;
    }

    function setAnim(name, loopOverride) {
      if (!playerSprite.sprite) return;
      const meta = SHEETS[name]; if (!meta) return;
      const mgr = playerSprite.mgr[name]; if (!mgr) return;

      const old = playerSprite.sprite;
      const pos = old.position.clone();         // keep current Y (air)
      const facingLeft = (state.facing < 0);
      old.dispose();

      const sp = new BABYLON.Sprite('playerSprite', mgr);
      const sizeUnits = playerSprite.sizeByAnim[name] ?? playerSprite.sizeUnits;
      sp.size = sizeUnits;
      sp.position = new BABYLON.Vector3(pos.x, pos.y, 0);
      sp.invertU = facingLeft;
      const loop = (typeof loopOverride === 'boolean') ? loopOverride : !!meta.loop;
      sp.playAnimation(0, meta.frames - 1, loop, 1000 / meta.fps);

      // NOTE: do NOT manually freeze last frame; Babylon already stops at 'to' when loop=false.
      // Manual freezing could keep a non-looping anim "stuck" visually if the state machine doesn't override.

      playerSprite.sprite = sp;
      playerSprite.state = name;
      playerSprite.sizeUnits = sizeUnits;
      playerSprite.loop = loop;
      playerSprite.animStarted = performance.now();
      playerSprite.animDurationMs = (meta.frames / meta.fps) * 1000;
    }

    async function initHealFx() {
      const { ok, w: sheetW, h: sheetH } = await loadImage(HEAL_FX_META.url);
      if (!ok) { console.warn('Heal FX sheet missing; skipping.'); return; }
      const frameW = Math.floor(sheetW / HEAL_FX_META.frames);
      const frameH = sheetH;
      healFx.sizeUnits = frameH / PPU;
      healFx.frameH = frameH;
      healFx.animDuration = (HEAL_FX_META.frames / HEAL_FX_META.fps) * 1000;
      const mgr = new BABYLON.SpriteManager('fx_heal', HEAL_FX_META.url, 1,
        { width: frameW, height: frameH }, scene);
      mgr.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
      mgr.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
      mgr.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
      healFx.mgr = mgr;
    }

    function playHealFx() {
      if (!healFx.mgr) return;
      if (healFx.sprite) { healFx.sprite.dispose(); healFx.sprite = null; }
      const sp = new BABYLON.Sprite('fx_heal_active', healFx.mgr);
      sp.size = healFx.sizeUnits;
      const torsoY = torsoCenterY();
      sp.position = new BABYLON.Vector3(placeholder.position.x, torsoY, 0);
      sp.playAnimation(0, HEAL_FX_META.frames - 1, false, 1000 / HEAL_FX_META.fps);
      healFx.sprite = sp;
      healFx.animStart = performance.now();
    }

    function stopHealFx() {
      if (healFx.sprite) {
        healFx.sprite.dispose();
        healFx.sprite = null;
      }
      healFx.animStart = 0;
    }

    function triggerHealScreenFx() {
      if (!healScreenEl) return;
      if (healScreenTimer) { clearTimeout(healScreenTimer); healScreenTimer = null; }
      healScreenEl.classList.remove('active');
      void healScreenEl.offsetWidth;
      healScreenEl.classList.add('active');
      healScreenTimer = setTimeout(() => {
        healScreenEl.classList.remove('active');
        healScreenTimer = null;
      }, stats.flaskSip * 1000);
    }

    function stopHealScreenFx() {
      if (!healScreenEl) return;
      if (healScreenTimer) { clearTimeout(healScreenTimer); healScreenTimer = null; }
      healScreenEl.classList.remove('active');
    }

    function cleanupFlaskState({ keepActing = false } = {}) {
      if (state.flasking) {
        state.flasking = false;
        state.flaskPhase = '';
        state.flaskStart = 0;
        state.flaskEndAt = 0;
        state.flaskHealApplied = false;
        state.flaskKneelDoneAt = 0;
      }
      stats.flaskLock = 0;
      stopHealFx();
      stopHealScreenFx();
      if (!keepActing) state.acting = false;
    }

    async function initPlayerSprite() {
      // Idle -> detect baseline
      const idleMgr = await createManagerAuto('idle', true);
      if (!idleMgr.ok) { console.warn('Idle sheet missing; keeping placeholder.'); return; }
      playerSprite.mgr.idle = idleMgr.mgr;
      playerSprite.sizeUnits = playerSprite.sizeByAnim.idle ?? playerSprite.sizeUnits;

      // Movement
      const walkMgr = await createManagerAuto('walk');   if (walkMgr.ok)  playerSprite.mgr.walk  = walkMgr.mgr;
      const runMgr  = await createManagerAuto('run');    if (runMgr.ok)   playerSprite.mgr.run   = runMgr.mgr;
      const rollMgr = await createManagerAuto('roll');   if (rollMgr.ok)  playerSprite.mgr.roll  = rollMgr.mgr;
      const kneelDMgr = await createManagerAuto('kneelDown'); if (kneelDMgr.ok) playerSprite.mgr.kneelDown = kneelDMgr.mgr;
      const kneelUMgr = await createManagerAuto('kneelUp');   if (kneelUMgr.ok) playerSprite.mgr.kneelUp = kneelUMgr.mgr;

      // Ladder climb
      const cu = await createManagerAuto('climbUp');   if (cu.ok) playerSprite.mgr.climbUp = cu.mgr;
      const cd = await createManagerAuto('climbDown'); if (cd.ok) playerSprite.mgr.climbDown = cd.mgr;

      // Light combo
      const l1 = await createManagerAuto('light1'); if (l1.ok) playerSprite.mgr.light1 = l1.mgr;
      const l2 = await createManagerAuto('light2'); if (l2.ok) playerSprite.mgr.light2 = l2.mgr;
      const l3 = await createManagerAuto('light3'); if (l3.ok) playerSprite.mgr.light3 = l3.mgr;

      // Air & heavy
      const j  = await createManagerAuto('jump');    if (j.ok)  playerSprite.mgr.jump    = j.mgr;
      const f  = await createManagerAuto('fall');    if (f.ok)  playerSprite.mgr.fall    = f.mgr;
      const la = await createManagerAuto('landing'); if (la.ok) playerSprite.mgr.landing = la.mgr;
      const hv = await createManagerAuto('heavy'); if (hv.ok) playerSprite.mgr.heavy = hv.mgr;

      // Hurt + Death
      const h  = await createManagerAuto('hurt');  if (h.ok)  playerSprite.mgr.hurt  = h.mgr;
      const d  = await createManagerAuto('death'); if (d.ok)  playerSprite.mgr.death = d.mgr;

      // Block + Parry
      const b  = await createManagerAuto('block'); if (b.ok)  playerSprite.mgr.block = b.mgr;
      const p  = await createManagerAuto('parry'); if (p.ok)  playerSprite.mgr.parry = p.mgr;

      // Create sprite aligned with placeholder
      const sp = new BABYLON.Sprite('playerSprite', playerSprite.mgr.idle);
      sp.size = playerSprite.sizeUnits;
      sp.position = new BABYLON.Vector3(placeholder.position.x, placeholder.position.y, 0);
      sp.playAnimation(0, SHEETS.idle.frames - 1, true, 1000 / SHEETS.idle.fps);
      playerSprite.sprite = sp;

      // Shadow scale
      shadow.scaling.x = playerSprite.sizeUnits * 0.6;
      shadow.scaling.z = playerSprite.sizeUnits * 0.35;

      placeholder.setEnabled(false);
    }
      initPlayerSprite();
      initHealFx();
      createLadder(2, 0, 4);
      spawnShrine(-2, 0);

      // === Enemies ===
      const enemies = [];
      let enemyDbg = false;
      function toggleEnemyDebug() {
        enemyDbg = !enemyDbg;
        enemies.forEach(e => {
          if (e.debugMesh) e.debugMesh.isVisible = enemyDbg;
          if (e.debugLabel) e.debugLabel.mesh.isVisible = enemyDbg;
        });
      }

      function centerFromFoot(e, footY) {
        return footY + (e.sizeUnits * 0.5) - e.baselineUnits;
      }

      async function loadEnemySheet(e, name, url, fps, loop, computeBaseline) {
        const { ok, img, w: sheetW, h: sheetH } = await loadImage(url);
        if (!ok) return;
        const frames = Math.max(1, Math.round(sheetW / sheetH));
        const frameW = Math.floor(sheetW / frames);
        const frameH = sheetH;
        if (computeBaseline) {
          const baselinePx = await detectBaselinePx(img, sheetW, sheetH, frames, frameW, frameH);
          e.baselineUnits = baselinePx / PPU;
        }
        e.sizeUnits = frameH / PPU;
        const mgr = new BABYLON.SpriteManager(`${e.type}_${name}`, url, 1, { width: frameW, height: frameH }, scene);
        mgr.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
        mgr.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        mgr.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        e.mgr[name] = { mgr, frames, fps, loop };
      }

      function setEnemyAnim(e, name) {
        const meta = e.mgr[name];
        if (!meta) return;
        if (e.anim === name && e.sprite) return;
        const pos = e.sprite ? e.sprite.position.clone() : new BABYLON.Vector3(e.x, e.y, 0);
        if (e.sprite) e.sprite.dispose();
        const sp = new BABYLON.Sprite(`${e.type}_${name}`, meta.mgr);
        sp.size = e.sizeUnits;
        sp.position = pos;
        sp.invertU = (e.facing < 0);
        sp.playAnimation(0, meta.frames - 1, meta.loop, 1000 / meta.fps);
        e.sprite = sp;
        e.anim = name;
        e.animStart = performance.now();
        e.animDur = (meta.frames / meta.fps) * 1000;
      }

      async function spawnWolf(x, footY, minX, maxX) {
        const e = { type: 'wolf', mgr: {}, x, y: 0, vx: 0, vy: 0, facing: 1,
          onGround: true, anim: '', patrolMin: minX, patrolMax: maxX, dir: 1,
          gravity: -20, jumpVel: 6, jumpCd: 1, baselineUnits: 0, sizeUnits: 1 };
        await loadEnemySheet(e, 'run', 'assets/sprites/wolf/Run.png', 14, true, true);
        await loadEnemySheet(e, 'jumpUp', 'assets/sprites/wolf/JumpUp.png', 14, false);
        await loadEnemySheet(e, 'jumpMid', 'assets/sprites/wolf/JumpMid.png', 14, false);
        await loadEnemySheet(e, 'jumpDown', 'assets/sprites/wolf/JumpDown.png', 14, false);
        e.y = centerFromFoot(e, footY);
        setEnemyAnim(e, 'run');
        const box = BABYLON.MeshBuilder.CreateBox(`dbg_${e.type}`, { width: e.sizeUnits, height: e.sizeUnits, depth: 0.01 }, scene);
        const mat = new BABYLON.StandardMaterial('dbgMatWolf', scene);
        mat.wireframe = true; mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        box.material = mat; box.isVisible = enemyDbg; box.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const dt = new BABYLON.DynamicTexture(`lbl_${e.type}`, { width: 128, height: 32 }, scene, false);
        dt.hasAlpha = true;
        const lmat = new BABYLON.StandardMaterial('lblMatWolf', scene);
        lmat.diffuseTexture = dt; lmat.emissiveColor = new BABYLON.Color3(1, 1, 0); lmat.backFaceCulling = false;
        const plane = BABYLON.MeshBuilder.CreatePlane(`lbl_${e.type}`, { size: 1.5 }, scene);
        plane.material = lmat; plane.isVisible = enemyDbg; plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        e.debugMesh = box; e.debugLabel = { mesh: plane, tex: dt, ctx: dt.getContext() };
        enemies.push(e);
      }

      async function spawnBat(x, footY, minX, maxX) {
        const e = { type: 'bat', mgr: {}, x, y: 0, vx: 0, vy: 0, facing: 1,
          anim: 'sleep', state: 'sleep', patrolMin: minX, patrolMax: maxX, dir: 1,
          hover: footY, baselineUnits: 0, sizeUnits: 1, bob: 0 };
        await loadEnemySheet(e, 'sleep', 'assets/sprites/bat/Sleep.png', 1, true, true);
        await loadEnemySheet(e, 'wake', 'assets/sprites/bat/WakeUp.png', 12, false);
        await loadEnemySheet(e, 'fly', 'assets/sprites/bat/Flying.png', 12, true);
        e.y = centerFromFoot(e, footY);
        setEnemyAnim(e, 'sleep');
        const box = BABYLON.MeshBuilder.CreateBox(`dbg_${e.type}`, { width: e.sizeUnits, height: e.sizeUnits, depth: 0.01 }, scene);
        const mat = new BABYLON.StandardMaterial('dbgMatBat', scene);
        mat.wireframe = true; mat.emissiveColor = new BABYLON.Color3(0, 1, 0);
        box.material = mat; box.isVisible = enemyDbg; box.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const dt = new BABYLON.DynamicTexture(`lbl_${e.type}`, { width: 128, height: 32 }, scene, false);
        dt.hasAlpha = true;
        const lmat = new BABYLON.StandardMaterial('lblMatBat', scene);
        lmat.diffuseTexture = dt; lmat.emissiveColor = new BABYLON.Color3(1, 1, 0); lmat.backFaceCulling = false;
        const plane = BABYLON.MeshBuilder.CreatePlane(`lbl_${e.type}`, { size: 1.5 }, scene);
        plane.material = lmat; plane.isVisible = enemyDbg; plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        e.debugMesh = box; e.debugLabel = { mesh: plane, tex: dt, ctx: dt.getContext() };
        enemies.push(e);
      }

      function updateWolf(e, dt) {
        const playerX = playerSprite.sprite?.position.x ?? 0;
        const chaseRange = 5;
        const stopRange = 0.6; // keep some distance from the player
        const dx = playerX - e.x;
        if (Math.abs(dx) < chaseRange) {
          if (Math.abs(dx) > stopRange) {
            e.dir = (dx < 0) ? -1 : 1;
            e.vx = e.dir * 2.3;
          } else {
            e.vx = 0; // close enough – don't jitter on top of the player
          }
        } else {
          if (e.x < e.patrolMin) e.dir = 1;
          if (e.x > e.patrolMax) e.dir = -1;
          e.vx = e.dir * 2.3;
        }
        if (e.vx !== 0) e.facing = e.dir;
        if (e.onGround) {
          e.jumpCd -= dt;
          if (e.jumpCd <= 0) { e.vy = e.jumpVel; e.onGround = false; e.jumpCd = 2 + Math.random() * 2; }
        } else {
          e.vy += e.gravity * dt;
        }
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const ground = centerFromFoot(e, 0);
        if (e.y <= ground) { e.y = ground; e.vy = 0; e.onGround = true; }
        if (!e.onGround) {
          if (e.vy > 0.2) setEnemyAnim(e, 'jumpUp');
          else if (e.vy < -0.2) setEnemyAnim(e, 'jumpDown');
          else setEnemyAnim(e, 'jumpMid');
        } else {
          setEnemyAnim(e, 'run');
        }
        if (e.sprite) {
          e.sprite.position.x = e.x;
          e.sprite.position.y = e.y;
          e.sprite.invertU = (e.facing < 0);
        }
      }

      function updateBat(e, dt) {
        const playerX = playerSprite.sprite?.position.x ?? 0;
        const dist = Math.abs(playerX - e.x);
        if (e.state === 'sleep' && dist < 4) { e.state = 'wake'; setEnemyAnim(e, 'wake'); }
        if (e.state === 'wake' && performance.now() > e.animStart + e.animDur) {
          e.state = 'fly'; setEnemyAnim(e, 'fly');
        }
        if (e.state === 'fly') {
          if (dist < 5) e.dir = (playerX < e.x) ? -1 : 1;
          else {
            if (e.x < e.patrolMin) e.dir = 1;
            if (e.x > e.patrolMax) e.dir = -1;
          }
          e.vx = e.dir * 1.5;
          e.x += e.vx * dt;
          e.facing = e.dir;
          e.bob += dt;
          const hover = e.hover + Math.sin(e.bob * 2) * 0.3;
          e.y = centerFromFoot(e, hover);
        }
        if (e.sprite) {
          e.sprite.position.x = e.x;
          e.sprite.position.y = e.y;
          e.sprite.invertU = (e.facing < 0);
        }
      }

      function updateEnemies(dt) {
        enemies.forEach(e => {
          if (!e.sprite) return;
          if (e.type === 'wolf') updateWolf(e, dt); else updateBat(e, dt);
          if (e.debugMesh) { e.debugMesh.position.x = e.x; e.debugMesh.position.y = e.y; e.debugMesh.isVisible = enemyDbg; }
          if (e.debugLabel) {
            const lbl = e.debugLabel;
            lbl.mesh.position.x = e.x;
            lbl.mesh.position.y = e.y + e.sizeUnits * 0.6;
            if (enemyDbg) {
              lbl.ctx.clearRect(0, 0, 128, 32);
              lbl.ctx.fillStyle = '#ffff00';
              lbl.ctx.font = '16px monospace';
              lbl.ctx.fillText(e.state || e.anim, 2, 24);
              lbl.tex.update();
              lbl.mesh.isVisible = true;
            } else {
              lbl.mesh.isVisible = false;
            }
          }
        });
      }

      // spawn demo enemies
      spawnWolf(-4, 0, -6, -2);
      spawnBat(4, 2.5, 3, 8);

      // === Actions ===
    function triggerParry() {
      if (state.dead || state.blocking) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      state.parryOpen = true;
      state.parryUntil = performance.now() + PARRY_WINDOW_MS;

      state.flasking = false;
      state.acting = true; // prevent the state machine from swapping parry out
      if (playerSprite.mgr.parry) setAnim('parry', false);
      actionEndAt = performance.now() + PARRY_WINDOW_MS;
    }

    function startBlock() {
      if (state.dead || state.acting || state.blocking) return;
      state.blocking = true;
      if (playerSprite.mgr.block) setAnim('block', true);
      // Blocking doesn't set acting; you can still move while holding block
    }
    function stopBlock() {
      state.blocking = false;
      // Next tick the state machine will choose idle/walk/run/jump/fall
    }

    function tryFlask() {
      if (state.dead || stats.flaskCount <= 0 || state.rolling || state.blocking) return;
      if (state.acting && !state.flasking) return;
      if (state.flasking) return;
      setFlasks(stats.flaskCount - 1);
      const now = performance.now();
      state.acting = true;
      state.flasking = true;
      state.flaskPhase = 'kneelDown';
      state.flaskStart = now;
      state.flaskEndAt = now + stats.flaskSip * 1000;
      state.flaskHealApplied = false;
      stats.flaskLock = now + stats.flaskRollCancel * 1000;
      if (playerSprite.mgr.kneelDown) {
        setAnim('kneelDown', false);
        state.flaskKneelDoneAt = playerSprite.animStarted + playerSprite.animDurationMs;
      } else {
        state.flaskKneelDoneAt = now;
      }
      playHealFx();
      triggerHealScreenFx();
    }

    function startRoll() {
      if (state.dead || state.rolling) return;
      const flasking = state.flasking;
      if (state.acting && !flasking) return;
      if (stats.stam < stats.rollCost) return;
      if (flasking) cleanupFlaskState();
      setST(stats.stam - stats.rollCost);
      state.rolling = true; state.rollT = 0; state.iFramed = false;
      setAnim('roll', true);
    }

    // Light combo
    function startLightStage(stage) {
      if (state.dead || state.blocking) return false;
      const name = stage === 1 ? 'light1' : stage === 2 ? 'light2' : 'light3';
      const meta = SHEETS[name]; if (!meta || !playerSprite.mgr[name]) return false;
      if (stats.stam < stats.lightCost) return false;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      setST(stats.stam - stats.lightCost);
      state.flasking = false;
      state.acting = true; combo.stage = stage; combo.queued = false;
      setAnim(name, false);
      const now = performance.now();
      combo.endAt = now + playerSprite.animDurationMs;
      combo.cancelAt = now + playerSprite.animDurationMs * (meta.cancelFrac ?? 0.6);
      return true;
    }
    function tryStartLight() {
      if (state.dead || state.rolling || state.blocking) return;
      if (combo.stage > 0) { combo.queued = true; return; }
      startLightStage(1);
    }

    // Heavy (grounded only; one-shot)
    function doHeavy() {
      if (state.dead || state.rolling || state.acting || state.blocking) return;
      if (!playerSprite.mgr.heavy) return;
      if (stats.stam < stats.heavyCost) return;
      setST(stats.stam - stats.heavyCost);
      state.flasking = false;
      state.acting = true;
      combo.stage = 0; combo.queued = false;
      setAnim('heavy', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }

    // Hurt + Death
    function triggerHurt(dmg = 15) {
      if (state.dead) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      setHP(stats.hp - dmg);
      if (stats.hp <= 0) { die(); return; }
      state.flasking = false;
      state.acting = true; combo.stage = 0; combo.queued = false;
      setAnim('hurt', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }
    function die() {
      if (state.dead) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      state.dead = true; state.acting = true; state.flasking = false; state.vx = 0; state.vy = 0;
      state.blocking = false; state.parryOpen = false;
      combo.stage = 0; combo.queued = false;
      setAnim('death', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }

    function startRespawn() {
      fadeEl.classList.add('show');
      setTimeout(() => {
        placeholder.position.x = respawn.x;
        placeholder.position.y = respawn.y;
        state.vx = 0; state.vy = 0; state.onGround = true; state.climbing = false;
        setHP(stats.hpMax); setST(stats.stamMax); setFlasks(stats.flaskMax);
        state.dead = false; state.acting = false; state.flasking = false;
        setAnim('idle', true);
        playerSprite.sprite.position.x = placeholder.position.x;
        playerSprite.sprite.position.y = placeholder.position.y;
        fadeEl.classList.remove('show');
      }, 600);
    }

    // === OVERLAY ===
    let showColliders = false;
    let slowMo = false;
    function toggleColliders() {
      showColliders = !showColliders;
      ladders.forEach(l => { if (l.mesh) l.mesh.isVisible = showColliders; });
      console.log('Collider meshes', showColliders ? 'ON' : 'OFF');
    }
    function toggleSlowMo() { slowMo = !slowMo; console.log('Slow-mo', slowMo ? 'ON' : 'OFF'); }
    const overlayEl = document.getElementById('overlay');
    let overlayShow = false;
    function toggleOverlay() { overlayShow = !overlayShow; overlayEl.style.display = overlayShow ? 'block' : 'none'; }
    function updateOverlay() {
      if (!overlayShow) return;
      const now = performance.now();
      const parryRemain = Math.max(0, state.parryUntil - now);
      overlayEl.textContent =
        `FPS:${engine.getFps().toFixed(0)}  Cam:ORTHO h=${ORTHO_VIEW_HEIGHT}\n` +
        `Anim:${playerSprite.state} loop:${playerSprite.loop}  size:${playerSprite.sizeUnits?.toFixed(2)} base:${playerSprite.baselineUnits?.toFixed(3)}\n` +
        `Y:${playerSprite.sprite?.position.y.toFixed(2)} FeetCenter:${feetCenterY().toFixed(2)} Ground:0 Air:${!state.onGround}\n` +
        `HP:${Math.round(stats.hp)}/${stats.hpMax}  ST:${Math.round(stats.stam)}  Dead:${state.dead}  Climb:${state.climbing}\n` +
        `Block:${state.blocking}  ParryOpen:${state.parryOpen} (${parryRemain.toFixed(0)}ms)\n` +
        `vx:${state.vx.toFixed(2)} vy:${state.vy.toFixed(2)}  Roll:${state.rolling} Acting:${state.acting} Combo(stage:${combo.stage} queued:${combo.queued})\n` +
        (enemyDbg ? enemies.map((e,i)=>`E${i}:${e.type} st:${e.state||e.anim} x:${e.x.toFixed(2)} y:${e.y.toFixed(2)}`).join('\n') + '\n' : '') +
        `[F7] slowMo:${slowMo}  |  [F8] colliders:${showColliders}  |  [F9] overlay  |  [F10] enemyDbg  |  A/D move, W/S climb, Space jump, L roll, tap I=Parry, hold I=Block, J light, K heavy, F flask, E interact, Shift run  |  Debug: H hurt X die`;
    }

    // === Game loop ===
    engine.runRenderLoop(() => {
      const rawDt = engine.getDeltaTime() / 1000;
      const dt = rawDt * (slowMo ? 0.25 : 1);
      const now = performance.now();

      if (state.flasking) {
        if (!state.flaskHealApplied && now >= stats.flaskLock) {
          setHP(stats.hp + stats.hpMax * stats.flaskHealPct);
          state.flaskHealApplied = true;
        }
        if (state.flaskPhase === 'kneelDown' && now >= state.flaskKneelDoneAt) {
          state.flaskPhase = 'channel';
        }
        if (state.flaskPhase !== 'kneelUp' && now >= state.flaskEndAt) {
          state.flaskPhase = 'kneelUp';
          stopHealFx();
          stopHealScreenFx();
          if (playerSprite.mgr.kneelUp) {
            setAnim('kneelUp', false);
            actionEndAt = performance.now() + playerSprite.animDurationMs;
          } else {
            cleanupFlaskState();
          }
        }
      }

      // Ladder detection
      const ladder = ladders.find(l =>
        placeholder.position.x > l.x - l.width * 0.5 &&
        placeholder.position.x < l.x + l.width * 0.5 &&
        placeholder.position.y >= l.y0 &&
        placeholder.position.y <= l.y1);
      if (ladder) {
        state.climbing = true;
        placeholder.position.x = ladder.x;
      } else if (state.climbing) {
        state.climbing = false;
      }

      // Shrine proximity & prompt
      let shrineTarget = null;
      const footY = placeholder.position.y - feetCenterY();
      for (const s of shrines) {
        if (Math.abs(placeholder.position.x - s.x) < 1 && Math.abs(footY - s.y) < 1) {
          shrineTarget = s; break;
        }
      }
      if (shrineTarget) showPrompt('[E] Rest'); else hidePrompt();
      if (shrineTarget && Keys.interact) { activateShrine(shrineTarget); Keys.interact = false; }

      // Inputs → intentions
      if (!state.acting && !state.dead) {
        const want = (Keys.left ? -1 : 0) + (Keys.right ? 1 : 0);
        if (want !== 0) state.facing = want;

        if (state.climbing) {
          state.vx = 0;
          const climb = (Keys.up ? stats.climbSpeed : 0) + (Keys.down ? -stats.climbSpeed : 0);
          state.vy = climb;
          if (Keys.jump) { state.climbing = false; state.vy = stats.jumpVel; state.onGround = false; Keys.jump = false; }
        } else {
          const speedMax = Keys.runHold ? stats.runMax : stats.walkMax;
          const target = want * speedMax;
          const a = (Math.abs(target) > Math.abs(state.vx)) ? stats.accel : stats.decel;
          if (state.vx < target) state.vx = Math.min(target, state.vx + a * dt);
          else if (state.vx > target) state.vx = Math.max(target, state.vx - a * dt);

          const canCoyote = (now - state.lastGrounded) <= stats.coyoteTime * 1000;
          const buffered = (now - state.jumpBufferedAt) <= stats.inputBuffer * 1000;
          if (buffered && (state.onGround || canCoyote)) {
            state.vy = stats.jumpVel;
            state.onGround = false;
            state.jumpBufferedAt = 0;
            state.landing = false;
            state.landingStartAt = 0;
            state.landingUntil = 0;
            state.landingTriggeredAt = 0;
          }
        }
      } else {
        // damp movement during actions
        if (state.vx > 0) state.vx = Math.max(0, state.vx - stats.decel * dt);
        else if (state.vx < 0) state.vx = Math.min(0, state.vx + stats.decel * dt);
      }

      // Roll
      if (Keys.roll) { startRoll(); Keys.roll = false; }
      if (state.rolling) {
        state.rollT += dt;
        state.vx = state.facing * stats.rollSpeed;
        const t = state.rollT;
        state.iFramed = (t >= stats.iFrameStart) && (t <= stats.iFrameEnd);
        if (state.rollT >= stats.rollDur) { state.rolling = false; state.iFramed = false; }
      }

      // Light/Heavy/Flask/Debug
      if (Keys.light) { tryStartLight(); Keys.light = false; }
      if (Keys.heavy) { doHeavy(); Keys.heavy = false; }
      if (Keys.flask) { tryFlask(); Keys.flask = false; }
      if (Keys.debugHurt) { triggerHurt(15); Keys.debugHurt = false; }
      if (Keys.debugDie)  { die(); Keys.debugDie = false; }

      // Parry window close
      if (state.parryOpen && now > state.parryUntil) state.parryOpen = false;

      // Handle light combo progression
      if (combo.stage > 0 && now >= combo.endAt) {
        const cur = 'light' + combo.stage;
        const next = SHEETS[cur].next;
        if (combo.queued && next && startLightStage(combo.stage + 1)) {
          // next stage started
        } else {
          combo.stage = 0; combo.queued = false;
          state.acting = false;
        }
      }
      // Handle generic action end (hurt, heavy, parry, death)
      if (state.acting && actionEndAt && now >= actionEndAt) {
        if (state.dead) startRespawn();
        else if (state.flasking) cleanupFlaskState();
        else state.acting = false;
        actionEndAt = 0;
        state.parryOpen = false; // ensure parry window is closed
      }

      // Physics (drive placeholder)
      const wasOnGround = state.onGround;
      let vyBefore = state.vy;
      if (!state.dead) {
        if (state.climbing) {
          vyBefore = state.vy;
          placeholder.position.x += state.vx * dt;
          placeholder.position.y += state.vy * dt;
        } else {
          state.vy += stats.gravity * dt;
          vyBefore = state.vy;
          placeholder.position.x += state.vx * dt;
          placeholder.position.y += state.vy * dt;
        }
      }

      // Ground clamp (feet at y=0 => center at feetCenterY)
      const groundCenter = feetCenterY();
      let justLanded = false;
      if (placeholder.position.y <= groundCenter) {
        placeholder.position.y = groundCenter;
        if (!state.onGround) state.lastGrounded = now;
        state.onGround = true;
        if (state.vy < 0) state.vy = 0;
        justLanded = !wasOnGround;
      } else {
        state.onGround = false;
      }

      if (justLanded) {
        const landingMeta = SHEETS.landing;
        const falling = vyBefore < -0.2;
        const jumpBuffered = state.jumpBufferedAt &&
          (now - state.jumpBufferedAt) <= stats.inputBuffer * 1000;
        const jumpPressedRecently = state.lastJumpPressAt &&
          (now - state.lastJumpPressAt) <= LANDING_SPAM_GRACE_MS;
        const canTriggerLanding = falling && landingMeta && playerSprite.mgr.landing && playerSprite.sprite &&
          !state.rolling && (!state.acting || state.flasking) && !state.blocking && !state.dead &&
          !jumpBuffered && !jumpPressedRecently;
        if (canTriggerLanding) {
          const dur = (landingMeta.frames / landingMeta.fps) * 1000;
          state.landing = true;
          state.landingTriggeredAt = now;
          state.landingStartAt = now + LANDING_MIN_GROUNDED_MS;
          state.landingUntil = state.landingStartAt + dur;
        } else {
          state.landing = false;
          state.landingTriggeredAt = 0;
          state.landingStartAt = 0;
          state.landingUntil = 0;
        }
      }

      // Drive sprite from placeholder
      if (playerSprite.sprite) {
        playerSprite.sprite.position.x = placeholder.position.x;
        playerSprite.sprite.position.y = placeholder.position.y;
        playerSprite.sprite.invertU = (state.facing < 0);
      }
      if (healFx.sprite) {
        healFx.sprite.position.x = placeholder.position.x;
        healFx.sprite.position.y = torsoCenterY();
        if (!state.flasking && healFx.animStart && now >= healFx.animStart + healFx.animDuration) {
          stopHealFx();
        }
      }

      // Shadow follows X; tiny shrink when airborne
      shadow.position.x = placeholder.position.x;
      const airH = Math.max(0, placeholder.position.y - groundCenter);
      const shrink = Math.max(0.6, 1 - airH * 0.23);
      shadow.scaling.x = playerSprite.sizeUnits * 0.6 * shrink;
      shadow.scaling.z = playerSprite.sizeUnits * 0.35 * shrink;

      // Animation state machine (skip while rolling/dead/other actions)
      let landingActive = false;
      if (state.landing) {
        const jumpBufferedNow = state.jumpBufferedAt &&
          (now - state.jumpBufferedAt) <= stats.inputBuffer * 1000;
        const jumpPressedAfterLanding = state.lastJumpPressAt > state.landingTriggeredAt;
        const eligibleNow = state.onGround && !state.blocking && (!state.acting || state.flasking) && !state.dead &&
          now < state.landingUntil && !jumpBufferedNow && !jumpPressedAfterLanding;
        if (!eligibleNow) {
          state.landing = false;
          state.landingStartAt = 0;
          state.landingUntil = 0;
          state.landingTriggeredAt = 0;
        } else if (now >= state.landingStartAt) {
          landingActive = true;
        }
      }

      const allowStateMachine = !state.rolling && !state.acting && !state.dead && playerSprite.sprite;
      if (allowStateMachine) {
        let targetAnim = 'idle';

        if (landingActive) {
          targetAnim = 'landing';
        } else if (state.blocking) {
          targetAnim = 'block'; // override while holding block
        } else if (state.climbing) {
          if (state.vy > 0.15) targetAnim = 'climbUp';
          else if (state.vy < -0.15) targetAnim = 'climbDown';
          else targetAnim = 'climbUp';
        } else if (!state.onGround) {
          if (state.vy > 0.15) targetAnim = 'jump';
          else if (state.vy < -0.15) targetAnim = 'fall';
        } else {
          const moving = Math.abs(state.vx) > 0.15;
          targetAnim = moving ? (Keys.runHold ? 'run' : 'walk') : 'idle';
        }

        if (playerSprite.state !== targetAnim) {
          const loopOverride = (targetAnim === 'landing') ? false : true;
          setAnim(targetAnim, loopOverride);
        }
      }

      // Camera follow (x only)
      camera.position.x = placeholder.position.x;
      camera.setTarget(new BABYLON.Vector3(placeholder.position.x, 1, 0));

      // Stamina regen (disabled during actions/roll/death)
      const busy = state.rolling || state.acting || state.dead;
      if (!busy && stats.stam < stats.stamMax) setST(stats.stam + stats.stamRegenPerSec * dt);
      updateEnemies(dt);
      updateOverlay();
      scene.render();
    });

    window.addEventListener('resize', () => { engine.resize(); fitOrtho(); });

    console.log('[EotR] Phase 2.3.1 (Parry/Block bugfix) boot OK');
  } catch (err) {
    console.error('Boot error:', err);
    alert('Boot error (see console for details).');
  }
})();







