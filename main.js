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

    // === INPUTS ===
    const Keys = {
      left: false, right: false, jump: false, roll: false,
      light: false, heavy: false, flask: false,
      runHold: false,
      debugHurt: false, debugDie: false
    };

    // Special handling for I (tap=parry, hold=block)
    let eIsDown = false;
    let blockTimer = null;

    const KeyMapDown = {
      'KeyA': 'left', 'ArrowLeft': 'left',
      'KeyD': 'right', 'ArrowRight': 'right',
      'Space': 'jump', 'KeyL': 'roll',
        'KeyJ': 'light', 'KeyK': 'heavy', 'KeyF': 'flask', 'F9': 'overlay', 'F10': 'enemyDbg',
        'ShiftLeft': 'runHold', 'ShiftRight': 'runHold',
        'KeyH': 'debugHurt', 'KeyX': 'debugDie'
      };
      const KeyMapUp = {
      'KeyA': 'left', 'ArrowLeft': 'left',
      'KeyD': 'right', 'ArrowRight': 'right',
      'Space': 'jump', 'KeyL': 'roll',
      'KeyJ': 'light', 'KeyK': 'heavy', 'KeyF': 'flask',
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
        else
          Keys[k] = true;
          if (k === 'jump') state.jumpBufferedAt = performance.now();
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
      jumpVel: 8, gravity: -20,
      coyoteTime: 0.12, inputBuffer: 0.12,
      rollDur: 0.35, rollSpeed: 6.0, iFrameStart: 0.10, iFrameEnd: 0.30, rollCost: 10,
      lightCost: 5, heavyCost: 18,
      flaskCount: 3, flaskHealPct: 0.55, flaskSip: 0.9, flaskRollCancel: 0.5, flaskLock: 0
    };
    const state = {
      onGround: true, vy: 0, vx: 0, lastGrounded: performance.now(), jumpBufferedAt: -Infinity,
      rolling: false, rollT: 0, iFramed: false,
      acting: false, facing: 1, dead: false,

      // New
      blocking: false,
      parryOpen: false,
      parryUntil: 0
    };

    // === HUD refs ===
    const hpFill = document.querySelector('#hp .fill');
    const stFill = document.querySelector('#stamina .fill');
    const flaskPips = [...document.querySelectorAll('#flasks .pip')];
    function setHP(v) { stats.hp = Math.max(0, Math.min(stats.hpMax, v)); hpFill.style.width = (stats.hp / stats.hpMax * 100) + '%'; }
    function setST(v) { stats.stam = Math.max(0, Math.min(stats.stamMax, v)); stFill.style.width = (stats.stam / stats.stamMax * 100) + '%'; }
    function setFlasks(n) { stats.flaskCount = n; flaskPips.forEach((p, i) => p.classList.toggle('used', i >= n)); }
    setHP(stats.hp); setST(stats.stam); setFlasks(stats.flaskCount);

    // === Sprite sheets ===
    const SHEETS = {
      idle:   { url: 'assets/sprites/player/Idle.png',   frames: 10, fps: 10, loop: true },
      walk:   { url: 'assets/sprites/player/Walk.png',   frames: 8,  fps: 12, loop: true },
      run:    { url: 'assets/sprites/player/Run.png',    frames: 8,  fps: 14, loop: true },
      roll:   { url: 'assets/sprites/player/Roll.png',   frames: 5,  fps: 18, loop: true },

      // Light combo
      light1: { url: 'assets/sprites/player/Light1.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'light2' },
      light2: { url: 'assets/sprites/player/Light2.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'light3' },
      light3: { url: 'assets/sprites/player/Light3.png', frames: 6,  fps: 16, loop: false, cancelFrac: 0.7, next: null },

      // Air & heavy
      jump:   { url: 'assets/sprites/player/Jump.png',   frames: 3,  fps: 16, loop: true },
      fall:   { url: 'assets/sprites/player/Fall.png',   frames: 3,  fps: 16, loop: true },
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
      sprite: null,
      state: 'idle',
      sizeUnits: 2,
      baselineUnits: (FALLBACK_BASELINE_PX / PPU),
      animStarted: 0,
      animDurationMs: 0,
      loop: true
    };

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
      playerSprite.sizeUnits = frameH / PPU;

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

      console.log(`[Sprite] ${metaKey}: sheet ${sheetW}x${sheetH}, frames=${meta.frames}, cell ${frameW}x${frameH}, sizeUnits=${playerSprite.sizeUnits.toFixed(2)}`);
      return { ok: true, mgr, frameW, frameH };
    }

    // Compute the center Y that puts FEET at ground (y=0)
    function feetCenterY() { return (playerSprite.sizeUnits * 0.5) - playerSprite.baselineUnits; }

    function setAnim(name, loopOverride) {
      if (!playerSprite.sprite) return;
      const meta = SHEETS[name]; if (!meta) return;
      const mgr = playerSprite.mgr[name]; if (!mgr) return;

      const old = playerSprite.sprite;
      const pos = old.position.clone();         // keep current Y (air)
      const facingLeft = (state.facing < 0);
      old.dispose();

      const sp = new BABYLON.Sprite('playerSprite', mgr);
      sp.size = playerSprite.sizeUnits;
      sp.position = new BABYLON.Vector3(pos.x, pos.y, 0);
      sp.invertU = facingLeft;
      const loop = (typeof loopOverride === 'boolean') ? loopOverride : !!meta.loop;
      sp.playAnimation(0, meta.frames - 1, loop, 1000 / meta.fps);

      // NOTE: do NOT manually freeze last frame; Babylon already stops at 'to' when loop=false.
      // Manual freezing could keep a non-looping anim "stuck" visually if the state machine doesn't override.

      playerSprite.sprite = sp;
      playerSprite.state = name;
      playerSprite.loop = loop;
      playerSprite.animStarted = performance.now();
      playerSprite.animDurationMs = (meta.frames / meta.fps) * 1000;
    }

    async function initPlayerSprite() {
      // Idle -> detect baseline
      const idleMgr = await createManagerAuto('idle', true);
      if (!idleMgr.ok) { console.warn('Idle sheet missing; keeping placeholder.'); return; }
      playerSprite.mgr.idle = idleMgr.mgr;

      // Movement
      const walkMgr = await createManagerAuto('walk');   if (walkMgr.ok)  playerSprite.mgr.walk  = walkMgr.mgr;
      const runMgr  = await createManagerAuto('run');    if (runMgr.ok)   playerSprite.mgr.run   = runMgr.mgr;
      const rollMgr = await createManagerAuto('roll');   if (rollMgr.ok)  playerSprite.mgr.roll  = rollMgr.mgr;

      // Light combo
      const l1 = await createManagerAuto('light1'); if (l1.ok) playerSprite.mgr.light1 = l1.mgr;
      const l2 = await createManagerAuto('light2'); if (l2.ok) playerSprite.mgr.light2 = l2.mgr;
      const l3 = await createManagerAuto('light3'); if (l3.ok) playerSprite.mgr.light3 = l3.mgr;

      // Air & heavy
      const j  = await createManagerAuto('jump');  if (j.ok)  playerSprite.mgr.jump  = j.mgr;
      const f  = await createManagerAuto('fall');  if (f.ok)  playerSprite.mgr.fall  = f.mgr;
      const hv = await createManagerAuto('heavy'); if (hv.ok) playerSprite.mgr.heavy = hv.mgr;

      // Hurt + Death
      const h  = await createManagerAuto('hurt');  if (h.ok)  playerSprite.mgr.hurt  = h.mgr;
      const d  = await createManagerAuto('death'); if (d.ok)  playerSprite.mgr.death = d.mgr;

      // Block + Parry
      const b  = await createManagerAuto('block'); if (b.ok)  playerSprite.mgr.block = b.mgr;
      const p  = await createManagerAuto('parry'); if (p.ok)  playerSprite.mgr.parry = p.mgr;

      // Create sprite with FEET on ground
      const sp = new BABYLON.Sprite('playerSprite', playerSprite.mgr.idle);
      sp.size = playerSprite.sizeUnits;
      sp.position = new BABYLON.Vector3(0, feetCenterY(), 0);
      sp.playAnimation(0, SHEETS.idle.frames - 1, true, 1000 / SHEETS.idle.fps);
      playerSprite.sprite = sp;

      // Shadow scale
      shadow.scaling.x = playerSprite.sizeUnits * 0.6;
      shadow.scaling.z = playerSprite.sizeUnits * 0.35;

      placeholder.setEnabled(false);
    }
      initPlayerSprite();

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
      state.parryOpen = true;
      state.parryUntil = performance.now() + PARRY_WINDOW_MS;

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
      if (state.dead || stats.flaskCount <= 0 || state.acting) return;
      setFlasks(stats.flaskCount - 1);
      state.acting = true;
      const start = performance.now();
      stats.flaskLock = start + stats.flaskRollCancel * 1000;
      const sip = setInterval(() => {
        const t = performance.now() - start;
        if (state.rolling && performance.now() > stats.flaskLock) { clearInterval(sip); state.acting = false; return; }
        if (t >= stats.flaskSip * 1000) { clearInterval(sip); setHP(stats.hp + stats.hpMax * stats.flaskHealPct); state.acting = false; }
      }, 10);
    }

    function startRoll() {
      if (state.dead || state.rolling || state.acting || stats.stam < stats.rollCost) return;
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
      setST(stats.stam - stats.lightCost);
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
      state.acting = true;
      combo.stage = 0; combo.queued = false;
      setAnim('heavy', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }

    // Hurt + Death
    function triggerHurt(dmg = 15) {
      if (state.dead) return;
      setHP(stats.hp - dmg);
      if (stats.hp <= 0) { die(); return; }
      state.acting = true; combo.stage = 0; combo.queued = false;
      setAnim('hurt', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }
    function die() {
      if (state.dead) return;
      state.dead = true; state.acting = true; state.vx = 0; state.vy = 0;
      state.blocking = false; state.parryOpen = false;
      combo.stage = 0; combo.queued = false;
      setAnim('death', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }

    // === OVERLAY ===
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
        `HP:${Math.round(stats.hp)}/${stats.hpMax}  ST:${Math.round(stats.stam)}  Dead:${state.dead}\n` +
        `Block:${state.blocking}  ParryOpen:${state.parryOpen} (${parryRemain.toFixed(0)}ms)\n` +
        `vx:${state.vx.toFixed(2)} vy:${state.vy.toFixed(2)}  Roll:${state.rolling} Acting:${state.acting} Combo(stage:${combo.stage} queued:${combo.queued})\n` +
        (enemyDbg ? enemies.map((e,i)=>`E${i}:${e.type} st:${e.state||e.anim} x:${e.x.toFixed(2)} y:${e.y.toFixed(2)}`).join('\n') + '\n' : '') +
        `[F9] overlay  |  [F10] enemyDbg  |  A/D, Space, L(roll), tap I=Parry, hold I=Block, J(light), K(heavy), F(flask), Hold Shift=Run  |  Debug: H(hurt) X(die)`;
    }

    // === Game loop ===
    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      const now = performance.now();

      // Inputs → intentions
      if (!state.acting && !state.dead) {
        const want = (Keys.left ? -1 : 0) + (Keys.right ? 1 : 0);
        if (want !== 0) state.facing = want;

        const speedMax = Keys.runHold ? stats.runMax : stats.walkMax;
        const target = want * speedMax;
        const a = (Math.abs(target) > Math.abs(state.vx)) ? stats.accel : stats.decel;
        if (state.vx < target) state.vx = Math.min(target, state.vx + a * dt);
        else if (state.vx > target) state.vx = Math.max(target, state.vx - a * dt);

        const canCoyote = (now - state.lastGrounded) <= stats.coyoteTime * 1000;
        const buffered = (now - state.jumpBufferedAt) <= stats.inputBuffer * 1000;
        if (buffered && (state.onGround || canCoyote)) {
          state.vy = stats.jumpVel; state.onGround = false; state.jumpBufferedAt = 0;
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
        if (!state.dead) state.acting = false;
        actionEndAt = 0;
        state.parryOpen = false; // ensure parry window is closed
      }

      // Physics (drive placeholder)
      if (!state.dead) {
        state.vy += stats.gravity * dt;
        placeholder.position.x += state.vx * dt;
        placeholder.position.y += state.vy * dt;
      }

      // Ground clamp (feet at y=0 => center at feetCenterY)
      const groundCenter = feetCenterY();
      if (placeholder.position.y <= groundCenter) {
        placeholder.position.y = groundCenter;
        if (!state.onGround) state.lastGrounded = now;
        state.onGround = true;
        if (state.vy < 0) state.vy = 0;
      } else {
        state.onGround = false;
      }

      // Drive sprite from placeholder
      if (playerSprite.sprite) {
        playerSprite.sprite.position.x = placeholder.position.x;
        playerSprite.sprite.position.y = placeholder.position.y;
        playerSprite.sprite.invertU = (state.facing < 0);
      }

      // Shadow follows X; tiny shrink when airborne
      shadow.position.x = placeholder.position.x;
      const airH = Math.max(0, placeholder.position.y - groundCenter);
      const shrink = Math.max(0.6, 1 - airH * 0.23);
      shadow.scaling.x = playerSprite.sizeUnits * 0.6 * shrink;
      shadow.scaling.z = playerSprite.sizeUnits * 0.35 * shrink;

      // Animation state machine (if NOT acting/rolling/dead)
      if (!state.rolling && !state.acting && !state.dead && playerSprite.sprite) {
        let targetAnim = 'idle';

        if (state.blocking) {
          targetAnim = 'block'; // override while holding block
        } else if (!state.onGround) {
          if (state.vy > 0.15) targetAnim = 'jump';
          else if (state.vy < -0.15) targetAnim = 'fall';
        } else {
          const moving = Math.abs(state.vx) > 0.15;
          targetAnim = moving ? (Keys.runHold ? 'run' : 'walk') : 'idle';
        }

        if (playerSprite.state !== targetAnim) setAnim(targetAnim, true);
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







