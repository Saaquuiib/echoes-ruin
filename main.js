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

  const HITSTOP_LIGHT_MS = 60;
  const HITSTOP_HEAVY_MS = 80;
  const HITSTOP_HEAVY_CHARGED_BONUS_MS = 20;
  const HITSTOP_HURT_MS = 90;

  const CAMERA_SHAKE_DURATION_MS = 60;
  const CAMERA_SHAKE_MAG = 0.12;        // world units for micro shake amplitude

  const ENEMY_FADE_DELAY_MS = 5000;
  const ENEMY_FADE_DURATION_MS = 1000;

  const HEAVY_CHARGE_MIN_MS = 400;
  const HEAVY_CHARGE_MAX_MS = 800;
  const HEAVY_HIT_FRAC = 0.45;          // fraction of release anim when impact is considered

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

  const Combat = (() => {
    let actorSeq = 1;
    let hurtSeq = 1;
    let hitSeq = 1;
    const actors = new Map();
    const hurtboxes = new Map();
    const hitboxes = [];

    function resolveActor(ref) {
      if (!ref) return null;
      if (typeof ref === 'string') return actors.get(ref) || null;
      if (typeof ref === 'object' && ref.id && actors.has(ref.id)) return ref;
      return null;
    }

    function resolveHurtbox(ref) {
      if (!ref) return null;
      if (typeof ref === 'string') return hurtboxes.get(ref) || null;
      if (typeof ref === 'object' && ref.id && hurtboxes.has(ref.id)) return ref;
      return null;
    }

    function registerActor(config = {}) {
      const id = config.id || `actor_${actorSeq++}`;
      if (actors.has(id)) throw new Error(`Combat actor id "${id}" already exists.`);
      const basePoise = config.poiseMax ?? config.poiseThreshold ?? config.maxPoise ?? 0;
      const initialPoise = config.initialPoise ?? (basePoise > 0 ? basePoise : 0);
      const actor = {
        id,
        team: config.team || 'neutral',
        hpMax: config.hpMax ?? config.maxHp ?? config.hp ?? 0,
        hp: config.hp ?? config.hpMax ?? config.maxHp ?? 0,
        getOrigin: config.getPosition || config.getOrigin || (() => ({ x: 0, y: 0 })),
        getFacing: config.getFacing || (() => 1),
        poiseThreshold: basePoise,
        poiseMax: basePoise,
        poise: Math.max(0, Math.min(initialPoise, basePoise || initialPoise)),
        poiseResetDelayMs: config.poiseResetDelayMs ?? 1200,
        poiseRegenPerSec: config.poiseRegenPerSec ?? 0,
        staggerDurationMs: config.staggerDurationMs ?? 600,
        staggeredUntil: 0,
        lastPoiseDamageAt: 0,
        invulnFlags: new Map(),
        hurtboxes: new Map(),
        alive: true,
        processHit: config.processHit || null,
        onPreHit: config.onPreHit || null,
        onPostHit: config.onPostHit || null,
        onDamage: config.onDamage || null,
        onHealthChange: config.onHealthChange || null,
        onDeath: config.onDeath || null,
        onPoiseChange: config.onPoiseChange || null,
        onStagger: config.onStagger || null,
        onStaggerEnd: config.onStaggerEnd || null,
        data: config.data || {},
        meta: config.meta || {}
      };
      actor.hpMax = actor.hpMax || actor.hp;
      actor.hp = Math.min(actor.hpMax, actor.hp);
      actors.set(id, actor);
      return actor;
    }

    function removeActor(ref) {
      const actor = resolveActor(ref);
      if (!actor) return;
      for (const hb of actor.hurtboxes.values()) {
        hurtboxes.delete(hb.id);
      }
      actor.hurtboxes.clear();
      actors.delete(actor.id);
      hitboxes.forEach(hb => {
        if (hb.actor === actor) hb.markRemove = true;
      });
    }

    function registerHurtbox(actorRef, config = {}) {
      const actor = resolveActor(actorRef);
      if (!actor) throw new Error('Combat.registerHurtbox: actor not found.');
      const id = config.id || `hurt_${hurtSeq++}`;
      const hurtbox = {
        id,
        actor,
        shape: config.shape || 'rect',
        width: config.width ?? config.size?.width ?? 0,
        height: config.height ?? config.size?.height ?? 0,
        radius: config.radius ?? config.size?.radius ?? 0,
        offset: { x: config.offset?.x ?? 0, y: config.offset?.y ?? 0 },
        mirror: config.mirror !== false,
        getOrigin: config.getOrigin || null,
        getFacing: config.getFacing || null,
        enabled: config.enabled !== undefined ? !!config.enabled : true,
        isEnabled: typeof config.isEnabled === 'function' ? config.isEnabled : null,
        absolute: !!config.absolute,
        tags: config.tags || null
      };
      actor.hurtboxes.set(id, hurtbox);
      hurtboxes.set(id, hurtbox);
      return hurtbox;
    }

    function updateHurtbox(ref, patch = {}) {
      const hurtbox = resolveHurtbox(ref);
      if (!hurtbox) return null;
      if (patch.shape) hurtbox.shape = patch.shape;
      if (patch.width != null) hurtbox.width = patch.width;
      if (patch.height != null) hurtbox.height = patch.height;
      if (patch.radius != null) hurtbox.radius = patch.radius;
      if (patch.offset) {
        if (patch.offset.x != null) hurtbox.offset.x = patch.offset.x;
        if (patch.offset.y != null) hurtbox.offset.y = patch.offset.y;
      }
      if (patch.enabled !== undefined) hurtbox.enabled = !!patch.enabled;
      if (patch.getOrigin) hurtbox.getOrigin = patch.getOrigin;
      if (patch.getFacing) hurtbox.getFacing = patch.getFacing;
      if (patch.mirror !== undefined) hurtbox.mirror = !!patch.mirror;
      if (patch.absolute !== undefined) hurtbox.absolute = !!patch.absolute;
      return hurtbox;
    }

    function setHurtboxEnabled(ref, enabled) {
      const hurtbox = resolveHurtbox(ref);
      if (!hurtbox) return;
      hurtbox.enabled = !!enabled;
    }

    function removeHurtbox(ref) {
      const hurtbox = resolveHurtbox(ref);
      if (!hurtbox) return;
      hurtbox.actor?.hurtboxes?.delete(hurtbox.id);
      hurtboxes.delete(hurtbox.id);
    }

    function spawnHitbox(actorRef, config = {}) {
      const actor = resolveActor(actorRef);
      if (!actor) throw new Error('Combat.spawnHitbox: actor not found.');
      const id = config.id || `hit_${hitSeq++}`;
      const now = performance.now();
      const delay = Math.max(0, config.delayMs || 0);
      const duration = Math.max(0, config.durationMs != null ? config.durationMs : 0);
      const hitbox = {
        id,
        actor,
        team: config.team || actor.team,
        shape: config.shape || 'rect',
        width: config.width ?? config.size?.width ?? 0,
        height: config.height ?? config.size?.height ?? 0,
        radius: config.radius ?? config.size?.radius ?? 0,
        offset: { x: config.offset?.x ?? 0, y: config.offset?.y ?? 0 },
        mirror: config.mirror !== false,
        getOrigin: config.getOrigin || null,
        getFacing: config.getFacing || null,
        absolute: !!config.absolute,
        damage: config.damage ?? 0,
        poise: config.poise ?? config.stagger ?? 0,
        pierce: !!config.pierce,
        friendlyFire: !!config.friendlyFire,
        ignoreInvuln: !!config.ignoreInvuln,
        applyDamage: config.applyDamage !== undefined ? !!config.applyDamage : true,
        applyPoise: config.applyPoise !== undefined ? !!config.applyPoise : true,
        activateAt: now + delay,
        expiresAt: now + delay + duration,
        durationMs: duration,
        meta: config.meta || null,
        onHit: config.onHit || null,
        onExpire: config.onExpire || null,
        alreadyHit: new Set(),
        hitCount: 0,
        didHit: false,
        markRemove: false
      };
      hitboxes.push(hitbox);
      return hitbox;
    }

    function computeShape(box) {
      const actor = box.actor || null;
      const originFn = box.getOrigin || actor?.getOrigin;
      const facingFn = box.getFacing || actor?.getFacing;
      const origin = originFn ? originFn(actor) : { x: 0, y: 0 };
      const facing = box.mirror === false ? 1 : (facingFn ? facingFn(actor) : 1);
      const offsetX = (box.offset?.x || 0) * (box.absolute ? 1 : facing);
      const offsetY = box.offset?.y || 0;
      const center = { x: origin.x + offsetX, y: origin.y + offsetY };
      if (box.shape === 'circle') {
        const radius = Math.max(0, box.radius || 0);
        return { type: 'circle', center, radius };
      }
      const width = Math.max(0, box.width || 0);
      const height = Math.max(0, box.height || 0);
      return {
        type: 'rect',
        center,
        width,
        height,
        minX: center.x - width * 0.5,
        maxX: center.x + width * 0.5,
        minY: center.y - height * 0.5,
        maxY: center.y + height * 0.5
      };
    }

    function rectsOverlap(a, b) {
      return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
    }

    function circlesOverlap(a, b) {
      const dx = a.center.x - b.center.x;
      const dy = a.center.y - b.center.y;
      const r = a.radius + b.radius;
      return (dx * dx + dy * dy) <= r * r;
    }

    function rectCircleOverlap(rect, circle) {
      const clampedX = Math.max(rect.minX, Math.min(circle.center.x, rect.maxX));
      const clampedY = Math.max(rect.minY, Math.min(circle.center.y, rect.maxY));
      const dx = circle.center.x - clampedX;
      const dy = circle.center.y - clampedY;
      return (dx * dx + dy * dy) <= circle.radius * circle.radius;
    }

    function shapesOverlap(a, b) {
      if (!a || !b) return false;
      if (a.type === 'rect' && b.type === 'rect') return rectsOverlap(a, b);
      if (a.type === 'circle' && b.type === 'circle') return circlesOverlap(a, b);
      if (a.type === 'rect' && b.type === 'circle') return rectCircleOverlap(a, b);
      if (a.type === 'circle' && b.type === 'rect') return rectCircleOverlap(b, a);
      return false;
    }

    function actorInvulnerable(actor, now) {
      if (!actor || actor.invulnFlags.size === 0) return false;
      let invuln = false;
      for (const [tag, until] of actor.invulnFlags) {
        if (until === Infinity) {
          invuln = true;
          continue;
        }
        if (now >= until) {
          actor.invulnFlags.delete(tag);
        } else {
          invuln = true;
        }
      }
      return invuln;
    }

    function applyDamage(actor, event) {
      const amount = Math.max(0, event.damage || 0);
      if (amount <= 0 || !actor.alive) return false;
      const prev = actor.hp;
      const next = Math.max(0, prev - amount);
      if (next === prev) return false;
      actor.hp = next;
      if (actor.onHealthChange) actor.onHealthChange(actor.hp, event);
      if (actor.onDamage) actor.onDamage(event);
      if (actor.hp <= 0 && actor.alive) {
        actor.alive = false;
        if (actor.onDeath) actor.onDeath(event);
      }
      return true;
    }

    function applyPoise(actor, event, now) {
      const amount = Math.max(0, event.poise || 0);
      if (amount <= 0 || actor.poiseMax <= 0 || !actor.alive) return false;
      const prev = actor.poise;
      actor.poise = Math.max(0, prev - amount);
      actor.lastPoiseDamageAt = now;
      let broke = false;
      if (actor.poise <= 0 && actor.poiseMax > 0 && actor.staggeredUntil <= now) {
        actor.staggeredUntil = now + actor.staggerDurationMs;
        broke = true;
        event.staggered = true;
        if (actor.onStagger) actor.onStagger(event);
      }
      if (actor.onPoiseChange) actor.onPoiseChange(actor.poise, event);
      return broke || actor.poise !== prev;
    }

    function setInvulnerable(actorRef, tag = 'default', enabled = true, durationMs = 0) {
      const actor = resolveActor(actorRef);
      if (!actor) return;
      const key = tag || 'default';
      if (enabled) {
        const until = durationMs > 0 ? performance.now() + durationMs : Infinity;
        actor.invulnFlags.set(key, until);
      } else {
        actor.invulnFlags.delete(key);
      }
    }

    function clearInvulnerability(actorRef, tag) {
      const actor = resolveActor(actorRef);
      if (!actor) return;
      if (tag) actor.invulnFlags.delete(tag); else actor.invulnFlags.clear();
    }

    function isInvulnerable(actorRef, now = performance.now()) {
      const actor = resolveActor(actorRef);
      if (!actor) return false;
      return actorInvulnerable(actor, now);
    }

    function update(dt, now = performance.now()) {
      const activeActors = Array.from(actors.values());
      for (const actor of activeActors) {
        actorInvulnerable(actor, now);
        if (!actor.alive) continue;
        if (actor.staggeredUntil > 0 && now >= actor.staggeredUntil) {
          actor.staggeredUntil = 0;
          if (actor.poiseMax > 0 && actor.poise < actor.poiseMax) {
            const prev = actor.poise;
            actor.poise = actor.poiseMax;
            actor.lastPoiseDamageAt = now;
            if (actor.poise !== prev && actor.onPoiseChange) {
              actor.onPoiseChange(actor.poise, { actor, now, refill: true });
            }
          }
          if (actor.onStaggerEnd) actor.onStaggerEnd({ actor, now });
        }
        if (actor.poiseMax > 0 && actor.poise < actor.poiseMax && actor.staggeredUntil <= 0) {
          const elapsed = now - actor.lastPoiseDamageAt;
          if (actor.poiseResetDelayMs <= 0 || elapsed >= actor.poiseResetDelayMs) {
            const prev = actor.poise;
            if (actor.poiseRegenPerSec > 0) {
              actor.poise = Math.min(actor.poiseMax, actor.poise + actor.poiseRegenPerSec * dt);
            } else {
              actor.poise = actor.poiseMax;
            }
            if (actor.poise !== prev && actor.onPoiseChange) {
              actor.onPoiseChange(actor.poise, { actor, now, regen: true });
            }
          }
        }
      }

      const hurtList = Array.from(hurtboxes.values());
      for (const hitbox of hitboxes) {
        if (hitbox.markRemove || !hitbox.actor.alive) {
          hitbox.markRemove = true;
          continue;
        }
        if (now < hitbox.activateAt) continue;
        const expired = now > hitbox.expiresAt;
        const hitShape = computeShape(hitbox);
        if (!hitShape) continue;
        for (const hurtbox of hurtList) {
          if (hurtbox.actor === hitbox.actor) continue;
          if (!hurtbox.actor.alive) continue;
          if (!hitbox.friendlyFire && hurtbox.actor.team === hitbox.team) continue;
          const enabled = hurtbox.isEnabled ? !!hurtbox.isEnabled() : hurtbox.enabled;
          if (!enabled) continue;
          if (hitbox.alreadyHit.has(hurtbox.id)) continue;
          if (!hitbox.ignoreInvuln && actorInvulnerable(hurtbox.actor, now)) continue;
          const hurtShape = computeShape(hurtbox);
          if (!hurtShape || !shapesOverlap(hitShape, hurtShape)) continue;

          const event = {
            now,
            source: hitbox.actor,
            target: hurtbox.actor,
            hitbox,
            hurtbox,
            firstHit: hitbox.hitCount === 0,
            applyDamage: hitbox.applyDamage,
            applyPoise: hitbox.applyPoise,
            handled: false,
            cancelled: false,
            meta: hitbox.meta || null,
            damage: 0,
            poise: 0,
            damageApplied: false,
            poiseApplied: false
          };
          event.damage = typeof hitbox.damage === 'function' ? hitbox.damage(event) : (hitbox.damage || 0);
          event.poise = typeof hitbox.poise === 'function' ? hitbox.poise(event) : (hitbox.poise || 0);

          if (hurtbox.actor.processHit) {
            hurtbox.actor.processHit(event);
          }
          if (hurtbox.actor.onPreHit) {
            hurtbox.actor.onPreHit(event);
          }
          if (event.cancelled) {
            hitbox.alreadyHit.add(hurtbox.id);
            hitbox.hitCount++;
            continue;
          }

          if (!event.handled) {
            if (event.applyDamage) {
              event.damageApplied = applyDamage(hurtbox.actor, event) || event.damageApplied;
            }
            if (event.applyPoise) {
              event.poiseApplied = applyPoise(hurtbox.actor, event, now) || event.poiseApplied;
            }
          }

          event.hitLanded = event.damageApplied || event.poiseApplied || event.handled;
          if (hurtbox.actor.onPostHit) hurtbox.actor.onPostHit(event);
          if (hitbox.onHit && event.hitLanded) hitbox.onHit(event);

          hitbox.alreadyHit.add(hurtbox.id);
          hitbox.hitCount++;
          if (event.hitLanded) hitbox.didHit = true;
          if (!hitbox.pierce) {
            hitbox.markRemove = true;
            break;
          }
        }
        if (expired) hitbox.markRemove = true;
      }

      if (hitboxes.length > 0) {
        const survivors = [];
        for (const hitbox of hitboxes) {
          if (hitbox.markRemove || now > hitbox.expiresAt) {
            if (hitbox.onExpire) {
              hitbox.onExpire({ now, hitbox, didHit: !!hitbox.didHit });
            }
            continue;
          }
          survivors.push(hitbox);
        }
        hitboxes.length = 0;
        hitboxes.push(...survivors);
      }
    }

    return {
      registerActor,
      removeActor,
      registerHurtbox,
      updateHurtbox,
      setHurtboxEnabled,
      removeHurtbox,
      spawnHitbox,
      setInvulnerable,
      clearInvulnerability,
      isInvulnerable,
      update,
      actors
    };
  })();

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
    const cameraTarget = new BABYLON.Vector3(0, 1, 0);
    camera.setTarget(cameraTarget);
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    function fitOrtho() {
      const aspect = engine.getRenderWidth() / engine.getRenderHeight();
      const top = ORTHO_VIEW_HEIGHT / 2;
      const right = top * aspect;
      camera.orthoTop = top; camera.orthoBottom = -top;
      camera.orthoLeft = -right; camera.orthoRight = right;
    }
    fitOrtho();

    const CAMERA_BASE_POS_Y = camera.position.y;
    const CAMERA_BASE_TARGET_Y = cameraTarget.y;

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

    let playerActor = null;
    let playerHurtbox = null;
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
      'F6': 'camShake', 'F7': 'slowMo', 'F8': 'colliders', 'F9': 'overlay', 'F10': 'enemyDbg',
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
      else if (k === 'camShake') toggleCameraShake();
      else if (k === 'heavy') {
        startHeavyCharge();
      } else {
        Keys[k] = true;
        if (k === 'jump') {
          const pressAt = performance.now();
          state.jumpBufferedAt = pressAt;
          state.lastJumpPressAt = pressAt;
        }
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
      if (k === 'heavy') {
        releaseHeavyCharge();
        return;
      }
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
      lightDamage: 12, lightStagger: 0.32,
      lightFinisherDamage: 16, lightFinisherStagger: 0.45,
      heavyDamage: 30, heavyStagger: 0.6,
      heavyChargeBonusDamage: 12, heavyChargeBonusStagger: 0.2,
      flaskCount: 3, flaskHealPct: 0.55, flaskSip: 0.9, flaskRollCancel: 0.5, flaskLock: 0, flaskMax: 3
    };
    const state = {
      onGround: true, vy: 0, vx: 0, lastGrounded: performance.now(), jumpBufferedAt: -Infinity, lastJumpPressAt: -Infinity,
      rolling: false, rollT: 0, iFramed: false,
      acting: false, facing: 1, dead: false,
      flasking: false,
      flaskStart: 0,
      flaskEndAt: 0,
      flaskHealApplied: false,

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

    playerActor = Combat.registerActor({
      id: 'player',
      team: 'player',
      hpMax: stats.hpMax,
      hp: stats.hp,
      getPosition: () => ({ x: placeholder.position.x, y: placeholder.position.y }),
      getFacing: () => state.facing,
      processHit: (event) => {
        if (state.dead) { event.cancelled = true; return; }
        if (state.blocking) {
          event.applyDamage = false;
          event.applyPoise = false;
          event.handled = true;
          event.blocked = true;
        }
      },
      onHealthChange: (hp) => { setHP(hp); },
      onDamage: (event) => { triggerHurt(event.damage, { alreadyApplied: true, event }); },
      onDeath: () => { if (!state.dead) die(); }
    });
    playerActor.hpMax = stats.hpMax;
    playerActor.hp = stats.hp;

    playerHurtbox = Combat.registerHurtbox(playerActor, {
      id: 'player_body',
      shape: 'rect',
      width: 0.7,
      height: 1.7,
      offset: { x: 0, y: 0 }
    });

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
    function setHP(v) {
      const clamped = Math.max(0, Math.min(stats.hpMax, v));
      stats.hp = clamped;
      hpFill.style.width = (stats.hp / stats.hpMax * 100) + '%';
      if (playerActor) {
        playerActor.hpMax = stats.hpMax;
        playerActor.hp = clamped;
      }
    }
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
    const HEAL_FX_FRONT_OFFSET = 0.01;
    const healFlash = {
      sprite: null,
      manager: null,
      active: false,
      start: 0,
      end: 0,
      maxAlpha: 0.65,
      fadeIn: 150,
      fadeOut: 220,
      color: new BABYLON.Color4(0, 0, 0, 0)
    };

    // Attack/Action timing
    const combo = { stage: 0, endAt: 0, cancelAt: 0, queued: false, pendingHit: false, hitAt: 0, hitMeta: null };
    const heavy = {
      charging: false,
      releasing: false,
      chargeStart: 0,
      chargeHoldMs: 0,
      minChargeAt: 0,
      maxChargeAt: 0,
      staminaSpent: false,
      charged: false,
      chargeRatio: 0,
      pendingHit: false,
      hitAt: 0,
      hitApplied: false,
      hitMeta: null,
      releaseDamage: 0,
      releaseStagger: 0,
      lastHoldMs: 0,
      lastDamage: 0,
      lastStagger: 0
    };
    const PLAYER_ATTACKS = {
      light1: {
        shape: 'rect',
        width: 1.05,
        height: 1.2,
        offset: { x: 0.85, y: 0 },
        damage: () => stats.lightDamage,
        poise: () => stats.lightStagger,
        durationMs: 110,
        hitFrac: 0.42,
        hitstopMs: HITSTOP_LIGHT_MS,
        shakeMagnitude: CAMERA_SHAKE_MAG * 0.72,
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS
      },
      light2: {
        shape: 'rect',
        width: 1.1,
        height: 1.2,
        offset: { x: 0.9, y: 0 },
        damage: () => stats.lightDamage,
        poise: () => stats.lightStagger,
        durationMs: 110,
        hitFrac: 0.42,
        hitstopMs: HITSTOP_LIGHT_MS,
        shakeMagnitude: CAMERA_SHAKE_MAG * 0.75,
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS
      },
      light3: {
        shape: 'rect',
        width: 1.25,
        height: 1.25,
        offset: { x: 1.0, y: 0 },
        damage: () => stats.lightFinisherDamage ?? stats.lightDamage,
        poise: () => stats.lightFinisherStagger ?? stats.lightStagger,
        durationMs: 120,
        hitFrac: 0.48,
        hitstopMs: HITSTOP_LIGHT_MS + 10,
        shakeMagnitude: CAMERA_SHAKE_MAG * 0.85,
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS
      },
      heavy: {
        shape: 'rect',
        width: 1.5,
        height: 1.3,
        offset: { x: 1.1, y: 0 },
        damage: () => heavy.releaseDamage,
        poise: () => heavy.releaseStagger,
        durationMs: 140,
        hitFrac: HEAVY_HIT_FRAC,
        hitstopMs: () => HITSTOP_HEAVY_MS + (heavy.charged ? HITSTOP_HEAVY_CHARGED_BONUS_MS : 0),
        shakeMagnitude: () => CAMERA_SHAKE_MAG * (heavy.charged ? 1.4 : 1.0),
        shakeDurationMs: () => CAMERA_SHAKE_DURATION_MS * (heavy.charged ? 1.2 : 1)
      }
    };
    const timeline = {
      hitstopUntil: 0,
      lastAnimationScale: 1,
      animRatioWrapped: false,
      baseGetAnimationRatio: null
    };
    const cameraShake = {
      enabled: true,
      active: false,
      start: 0,
      duration: 0,
      magnitude: 0,
      seed: 0,
      offsetX: 0,
      offsetY: 0
    };
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

      const mgr = new BABYLON.SpriteManager('mgr_' + metaKey, meta.url, 2, { width: frameW, height: frameH }, scene);
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

    function setAnim(name, loopOverride, opts = {}) {
      if (!playerSprite.sprite) return;
      const meta = SHEETS[name]; if (!meta) return;
      const mgr = playerSprite.mgr[name]; if (!mgr) return;

      const old = playerSprite.sprite;
      const pos = old.position.clone();         // keep current transform
      const prevSizeUnits = playerSprite.sizeUnits;
      const prevFeetCenter = (prevSizeUnits * 0.5) - playerSprite.baselineUnits;
      const facingLeft = (state.facing < 0);
      old.dispose();

      const sp = new BABYLON.Sprite('playerSprite', mgr);
      const sizeUnits = playerSprite.sizeByAnim[name] ?? playerSprite.sizeUnits;
      sp.size = sizeUnits;
      sp.position = new BABYLON.Vector3(pos.x, pos.y, pos.z ?? 0);
      sp.invertU = facingLeft;
      const loop = (typeof loopOverride === 'boolean') ? loopOverride : !!meta.loop;
      const shouldPlay = opts.play !== false;
      if (shouldPlay) {
        sp.playAnimation(0, meta.frames - 1, loop, 1000 / meta.fps);
      } else {
        const frame = Math.max(0, Math.min(meta.frames - 1, typeof opts.frame === 'number' ? opts.frame : 0));
        sp.cellIndex = frame;
      }

      // NOTE: default path avoids manual freezing so non-looping anims complete naturally.

      playerSprite.sprite = sp;
      playerSprite.state = name;
      playerSprite.sizeUnits = sizeUnits;
      playerSprite.loop = loop;
      playerSprite.animStarted = performance.now();
      if (typeof opts.manualDuration === 'number') {
        playerSprite.animDurationMs = opts.manualDuration;
      } else {
        playerSprite.animDurationMs = shouldPlay ? (meta.frames / meta.fps) * 1000 : 0;
      }

      if (state.onGround) {
        const newFeetCenter = feetCenterY();
        const delta = newFeetCenter - prevFeetCenter;
        if (Math.abs(delta) > 0.0001) {
          placeholder.position.y += delta;
          sp.position.y += delta;
          if (state.vy < 0) state.vy = 0;
        }
      }
    }

    function applyAnimationScale(scale) {
      if (!isFinite(scale)) return;
      if (Math.abs(timeline.lastAnimationScale - scale) < 0.001) return;
      timeline.lastAnimationScale = scale;
      if (typeof scene.animationTimeScale === 'number') {
        scene.animationTimeScale = scale;
        return;
      }
      if (!timeline.animRatioWrapped && typeof scene.getAnimationRatio === 'function') {
        const base = scene.getAnimationRatio.bind(scene);
        scene.getAnimationRatio = function () {
          return base() * timeline.lastAnimationScale;
        };
        timeline.baseGetAnimationRatio = base;
        timeline.animRatioWrapped = true;
      }
    }

    function requestHitstop(durationMs) {
      const now = performance.now();
      const dur = Math.max(0, durationMs || 0);
      const until = now + dur;
      if (until > timeline.hitstopUntil) timeline.hitstopUntil = until;
    }

    function hitstopRemaining(now = performance.now()) {
      return Math.max(0, timeline.hitstopUntil - now);
    }

    function triggerCameraShake({ magnitude = CAMERA_SHAKE_MAG, durationMs = CAMERA_SHAKE_DURATION_MS } = {}) {
      if (!cameraShake.enabled) return;
      const now = performance.now();
      const duration = Math.max(0, durationMs || 0);
      if (cameraShake.active) {
        const elapsed = now - cameraShake.start;
        const remain = Math.max(0, cameraShake.duration - elapsed);
        if (remain >= duration && cameraShake.magnitude >= magnitude) {
          return; // existing shake is stronger/longer
        }
      }
      cameraShake.active = duration > 0 && magnitude > 0;
      cameraShake.start = now;
      cameraShake.duration = duration;
      cameraShake.magnitude = magnitude;
      cameraShake.seed = Math.random() * Math.PI * 2;
      if (!cameraShake.active) {
        cameraShake.offsetX = 0;
        cameraShake.offsetY = 0;
      }
    }
    function updateCameraShake(now) {
      if (!cameraShake.enabled || !cameraShake.active) {
        cameraShake.active = cameraShake.enabled ? cameraShake.active : false;
        cameraShake.offsetX = 0;
        cameraShake.offsetY = 0;
        return;
      }
      const elapsed = now - cameraShake.start;
      if (elapsed >= cameraShake.duration) {
        cameraShake.active = false;
        cameraShake.offsetX = 0;
        cameraShake.offsetY = 0;
        return;
      }
      const t = Math.max(0, Math.min(1, elapsed / Math.max(1, cameraShake.duration)));
      const falloff = 1 - t;
      const angle = cameraShake.seed + t * Math.PI * 6;
      const magnitude = cameraShake.magnitude * falloff;
      cameraShake.offsetX = Math.cos(angle) * magnitude;
      cameraShake.offsetY = Math.sin(angle * 1.7) * magnitude * 0.6;
    }

    function applyImpactEffects({ hitstopMs, shakeMagnitude, shakeDurationMs } = {}) {
      if (hitstopMs) requestHitstop(hitstopMs);
      if (shakeMagnitude) {
        triggerCameraShake({ magnitude: shakeMagnitude, durationMs: shakeDurationMs ?? CAMERA_SHAKE_DURATION_MS });
      }
    }

    function onPlayerAttackLand(meta = {}) {
      if (!playerActor) return;
      const inferredId = meta.attackId || (meta.stage ? `light${meta.stage}` : null) || meta.type || 'light1';
      const attackDef = PLAYER_ATTACKS[inferredId] || PLAYER_ATTACKS.light1;
      if (!attackDef) return;
      const resolve = (value, fallbackMeta) => {
        if (value == null) return fallbackMeta;
        return value;
      };
      const damageVal = resolve(
        meta.damage,
        typeof attackDef.damage === 'function' ? attackDef.damage(meta) : attackDef.damage || 0
      );
      const poiseVal = resolve(
        meta.stagger ?? meta.poise,
        typeof attackDef.poise === 'function' ? attackDef.poise(meta) : attackDef.poise || 0
      );
      const durationMs = resolve(meta.durationMs, attackDef.durationMs ?? 0);
      const offset = meta.offset || attackDef.offset || { x: 0, y: 0 };
      const width = meta.width != null ? meta.width : attackDef.width ?? attackDef.size?.width ?? 0;
      const height = meta.height != null ? meta.height : attackDef.height ?? attackDef.size?.height ?? 0;
      const radius = meta.radius != null ? meta.radius : attackDef.radius ?? attackDef.size?.radius ?? 0;
      const shape = meta.shape || attackDef.shape || (radius > 0 ? 'circle' : 'rect');
      const pierce = meta.pierce != null ? meta.pierce : !!attackDef.pierce;
      const friendlyFire = meta.friendlyFire != null ? meta.friendlyFire : !!attackDef.friendlyFire;
      const hitstopMs = resolve(
        meta.hitstopMs,
        typeof attackDef.hitstopMs === 'function' ? attackDef.hitstopMs(meta) : attackDef.hitstopMs
      );
      const shakeMag = resolve(
        meta.shakeMagnitude,
        typeof attackDef.shakeMagnitude === 'function' ? attackDef.shakeMagnitude(meta) : attackDef.shakeMagnitude
      );
      const shakeDurationMs = resolve(
        meta.shakeDurationMs,
        typeof attackDef.shakeDurationMs === 'function' ? attackDef.shakeDurationMs(meta) : attackDef.shakeDurationMs
      );

      Combat.spawnHitbox(playerActor, {
        shape,
        width,
        height,
        radius,
        offset,
        durationMs,
        damage: damageVal,
        poise: poiseVal,
        pierce,
        friendlyFire,
        meta: { attackId: inferredId, stage: meta.stage, charged: meta.charged },
        onHit: (event) => {
          if (event.firstHit && event.hitLanded) {
            applyImpactEffects({ hitstopMs, shakeMagnitude: shakeMag, shakeDurationMs });
          }
        }
      });
    }

    applyAnimationScale(1);

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
      const playerSp = playerSprite.sprite;
      const basePos = playerSp ? playerSp.position : placeholder.position;
      const baseZ = (basePos && typeof basePos.z === 'number') ? basePos.z : 0;
      sp.position = new BABYLON.Vector3(basePos.x, basePos.y, baseZ - HEAL_FX_FRONT_OFFSET);
      if (playerSp && typeof playerSp.renderingGroupId === 'number') {
        sp.renderingGroupId = playerSp.renderingGroupId;
      }
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

    function disposeHealFlashSprite() {
      if (healFlash.sprite) {
        healFlash.sprite.dispose();
        healFlash.sprite = null;
      }
      healFlash.manager = null;
      if (healFlash.color) {
        healFlash.color.r = 0;
        healFlash.color.g = 0;
        healFlash.color.b = 0;
        healFlash.color.a = 0;
      }
    }

    function initHealFlash() {
      stopHealFlash();
    }

    function playHealFlash() {
      if (!playerSprite.sprite) return;
      const now = performance.now();
      healFlash.active = true;
      healFlash.start = now;
      healFlash.end = now + stats.flaskSip * 1000;
    }

    function stopHealFlash() {
      healFlash.active = false;
      healFlash.start = 0;
      healFlash.end = 0;
      disposeHealFlashSprite();
    }

    function ensureHealFlashSprite() {
      const playerSp = playerSprite.sprite;
      if (!playerSp) {
        disposeHealFlashSprite();
        return null;
      }
      const manager = playerSp._manager || playerSp.manager || null;
      if (!manager) {
        disposeHealFlashSprite();
        return null;
      }
      if (healFlash.sprite && healFlash.manager !== manager) {
        disposeHealFlashSprite();
      }
      if (!healFlash.sprite) {
        const sp = new BABYLON.Sprite('healFlashSprite', manager);
        sp.isPickable = false;
        sp.blendMode = BABYLON.Sprite.BLENDMODE_ADD;
        sp.color = healFlash.color;
        sp.cellIndex = playerSp.cellIndex;
        sp.size = playerSp.size;
        sp.position = playerSp.position.clone();
        sp.invertU = playerSp.invertU;
        sp.renderingGroupId = playerSp.renderingGroupId;
        healFlash.sprite = sp;
        healFlash.manager = manager;
      }
      return healFlash.sprite;
    }

    function updateHealFlash(now) {
      if (!healFlash.active && !healFlash.sprite) return;
      const sp = ensureHealFlashSprite();
      if (!sp) return;

      const playerSp = playerSprite.sprite;
      sp.position.x = playerSp.position.x;
      sp.position.y = playerSp.position.y;
      sp.size = playerSp.size;
      sp.cellIndex = playerSp.cellIndex;
      sp.invertU = playerSp.invertU;

      let strength = 0;
      if (healFlash.active) {
        if (now >= healFlash.end) {
          stopHealFlash();
          return;
        }
        const total = healFlash.end - healFlash.start;
        if (total <= 0) {
          stopHealFlash();
          return;
        }
        const t = now - healFlash.start;
        const fadeIn = healFlash.fadeIn;
        const fadeOut = healFlash.fadeOut;
        strength = healFlash.maxAlpha;
        if (t < fadeIn) {
          strength = healFlash.maxAlpha * (t / fadeIn);
        } else if (t > total - fadeOut) {
          const remain = Math.max(0, total - t);
          strength = healFlash.maxAlpha * (remain / fadeOut);
        }
      }

      strength = Math.max(0, Math.min(healFlash.maxAlpha, strength));
      healFlash.color.r = strength;
      healFlash.color.g = strength;
      healFlash.color.b = strength;
      healFlash.color.a = strength;
      sp.color = healFlash.color;
    }

    function cleanupFlaskState({ keepActing = false, stopFx = true } = {}) {
      if (state.flasking) {
        state.flasking = false;
        state.flaskStart = 0;
        state.flaskEndAt = 0;
        state.flaskHealApplied = false;
      }
      stats.flaskLock = 0;
      if (stopFx) {
        stopHealFx();
        stopHealFlash();
      }
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
      if (playerHurtbox) {
        Combat.updateHurtbox(playerHurtbox, {
          width: playerSprite.sizeUnits * 0.55,
          height: playerSprite.sizeUnits * 0.9,
          offset: { x: 0, y: 0 }
        });
      }

      // Shadow scale
      shadow.scaling.x = playerSprite.sizeUnits * 0.6;
      shadow.scaling.z = playerSprite.sizeUnits * 0.35;

      placeholder.setEnabled(false);
    }
      initPlayerSprite();
      initHealFx();
      initHealFlash();
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

      function randChoice(list) {
        if (!list || list.length === 0) return null;
        return list[Math.floor(Math.random() * list.length)];
      }
      function updateEnemyFade(e, now) {
        if (!e) return;
        if (!e.deathAt || !e.sprite) return;
        if (e.fadeDone) {
          e.sprite.isVisible = false;
          return;
        }
        const delay = e.fadeDelayMs ?? ENEMY_FADE_DELAY_MS;
        const duration = e.fadeDurationMs ?? ENEMY_FADE_DURATION_MS;
        const start = e.fadeStartAt || (e.deathAt + delay);
        if (!e.fadeStartAt) e.fadeStartAt = start;
        if (now < start) return;
        const progress = duration > 0 ? Math.min(1, Math.max(0, (now - start) / duration)) : 1;
        const alpha = 1 - progress;
        if (alpha <= 0.001) {
          e.sprite.isVisible = false;
          if (e.debugMesh) e.debugMesh.isVisible = false;
          if (e.debugLabel) e.debugLabel.mesh.isVisible = false;
          e.fadeDone = true;
          return;
        }
        e.sprite.color = new BABYLON.Color4(1, 1, 1, alpha);
      }
      const WOLF_COMBO_TABLE = {
        close: [
          ['bite'],
          ['claw'],
          ['bite', 'claw'],
          ['bite', 'bite', 'claw']
        ],
        mid: [
          ['bite'],
          ['bite', 'claw'],
          ['leap', 'bite'],
          ['leap', 'bite', 'claw']
        ],
        far: [
          ['leap', 'bite'],
          ['leap', 'bite', 'claw'],
          ['leap', 'bite', 'bite']
        ]
      };

      const WOLF_ATTACK_DATA = {
        bite: {
          anim: 'bite',
          hitFrac: 0.46,
          durationMs: 190,
          damage: 12,
          poise: 14,
          width: e => e.sizeUnits * 0.54,
          height: e => e.sizeUnits * 0.42,
          offset: e => ({ x: e.sizeUnits * 0.28, y: -e.sizeUnits * 0.05 }),
          maxRange: 1.05,
          forwardImpulse: 2.2,
          comboGapMs: 130,
          recoveryMs: 340,
          cooldownMs: 760
        },
        claw: {
          anim: 'claw',
          hitFrac: 0.5,
          durationMs: 200,
          damage: 15,
          poise: 16,
          width: e => e.sizeUnits * 0.6,
          height: e => e.sizeUnits * 0.5,
          offset: e => ({ x: e.sizeUnits * 0.34, y: -e.sizeUnits * 0.02 }),
          maxRange: 1.25,
          forwardImpulse: 2.6,
          comboGapMs: 160,
          recoveryMs: 420,
          cooldownMs: 840
        },
        leap: {
          type: 'maneuver',
          jumpVel: 6.8,
          forwardImpulse: 5,
          maxDurationMs: 900,
          minAirTime: 0.28,
          landBufferMs: 140,
          cooldownMs: 520
        }
      };

      const BAT_ATTACK_DATA = {
        contact: {
          anim: 'attack',
          hitFrac: 0.45,
          durationMs: 160,
          damage: 9,
          poise: 9,
          width: e => e.sizeUnits * 0.66,
          height: e => e.sizeUnits * 0.46,
          offset: e => ({ x: e.sizeUnits * 0.18, y: -e.sizeUnits * 0.08 }),
          cooldownMs: 900
        }
      };

      const BAT_AGGRO_RADIUS = 6;
      const BAT_AGGRO_HYSTERESIS = 1;
      const BAT_LEASH_RADIUS = 11;
      const BAT_VIEW_MARGIN = 0.5;
      const BAT_ATTACK_ACTIVE_FRAMES = { start: 3, end: 7 };
      const BAT_ATTACK_COOLDOWN_MS = 900;
      const BAT_FOLLOW_SPEED = 2.4;
      const BAT_FOLLOW_ACCEL = 9;
      const BAT_RETURN_SPEED = 1.6;
      const BAT_RETURN_ACCEL = 6;
      const BAT_FOLLOW_Y_OFFSET = 0.15;
      const BAT_VERTICAL_MAX_SPEED = 3.0;
      const BAT_VERTICAL_LERP = 0.12;
      const BAT_REBOUND_MAX_ABOVE_HOVER = 0.6;

      function computeWolfTargetX(e, playerX) {
        if (!Number.isFinite(playerX)) playerX = 0;
        const dx = playerX - e.x;
        const sign = dx >= 0 ? 1 : -1;
        let target;
        if (e.packRole === 'flankLeft') target = playerX - 1.9;
        else if (e.packRole === 'flankRight') target = playerX + 1.9;
        else if (e.packRole === 'leader') target = playerX - sign * 1.05;
        else target = playerX - sign * 2.2;
        if (!e.playerSeen && e.patrolMin !== undefined && e.patrolMax !== undefined) {
          target = Math.max(e.patrolMin, Math.min(e.patrolMax, target));
        }
        return target;
      }

      function chooseWolfCombo(e, distance) {
        let bucket = 'far';
        if (distance < 1.2) bucket = 'close';
        else if (distance < 3.2) bucket = 'mid';
        const allowLeap = distance >= 2.4;
        const base = WOLF_COMBO_TABLE[bucket] || WOLF_COMBO_TABLE.close;
        let pool = base
          .filter(seq => seq && (allowLeap || !seq.includes('leap')))
          .map(seq => seq.slice());
        if (e.packRole === 'leader') {
          pool.push(...WOLF_COMBO_TABLE.mid
            .filter(seq => seq && seq.length > 1 && (allowLeap || !seq.includes('leap')))
            .map(seq => seq.slice()));
        } else if (e.packRole && e.packRole.startsWith('flank')) {
          pool.push(['claw'], ['bite', 'claw']);
        }
        if (!allowLeap) {
          pool = pool.filter(seq => seq && !seq.includes('leap'));
        }
        if (pool.length === 0) {
          pool = WOLF_COMBO_TABLE.close
            .filter(seq => seq && !seq.includes('leap'))
            .map(seq => seq.slice());
        }
        if (distance > 1.8) {
          const withLeap = pool.filter(seq => seq && seq.includes('leap'));
          if (withLeap.length > 0) pool = withLeap.map(seq => seq.slice());
        }
        const choice = randChoice(pool);
        return choice ? choice.slice() : [];
      }

      function startWolfReady(e, delayMs = 220) {
        const now = performance.now();
        e.state = 'ready';
        e.readyUntil = now + delayMs;
        e.vx = 0;
        e.vy = 0;
        if (e.mgr.ready) setEnemyAnim(e, 'ready');
      }

      function spawnWolfHitbox(e, def) {
        if (!e.combat || !def || e.dying) return;
        const width = typeof def.width === 'function' ? def.width(e) : def.width;
        const height = typeof def.height === 'function' ? def.height(e) : def.height;
        const offset = typeof def.offset === 'function' ? def.offset(e) : def.offset || { x: 0, y: 0 };
        Combat.spawnHitbox(e.combat, {
          shape: 'rect',
          width: width ?? 0,
          height: height ?? 0,
          offset,
          durationMs: def.durationMs ?? 130,
          damage: typeof def.damage === 'function' ? def.damage(e) : def.damage ?? 0,
          poise: typeof def.poise === 'function' ? def.poise(e) : def.poise ?? 0,
          getOrigin: () => ({ x: e.x, y: e.y }),
          getFacing: () => e.facing,
          meta: { enemy: 'wolf', attack: e.currentAttack?.name || 'unknown' }
        });
      }

      function startWolfAttack(e, name) {
        const def = WOLF_ATTACK_DATA[name];
        const now = performance.now();
        if (!def) return false;
        if (def.type !== 'maneuver' && def.maxRange != null) {
          const playerPos = playerSprite.sprite?.position;
          const playerX = playerPos?.x;
          if (playerX == null || Math.abs(playerX - e.x) > def.maxRange) {
            e.state = 'stalk';
            e.attackQueue = [];
            e.comboIndex = 0;
            e.currentAttack = null;
            e.readyUntil = now;
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            e.nextComboAt = Math.max(e.nextComboAt, now + 180);
            return 'defer';
          }
        }
        const attack = { name, def, start: now, spawned: false };
        e.currentAttack = attack;
        if (def.type === 'maneuver') {
          e.state = 'leap';
          e.leapState = {
            def,
            start: now,
            endBy: now + (def.maxDurationMs ?? 800),
            airborneAt: now,
            landedAt: 0
          };
          e.vx = (def.forwardImpulse ?? 0) * e.facing;
          e.vy = def.jumpVel ?? 0;
          e.onGround = false;
          if (e.mgr.jumpUp) setEnemyAnim(e, 'jumpUp');
        } else {
          e.state = 'attack';
          if (def.anim && e.mgr[def.anim]) {
            setEnemyAnim(e, def.anim);
          }
          const animStart = e.animStart || now;
          const animDur = e.animDur || 0;
          attack.hitAt = animStart + animDur * (def.hitFrac ?? 0.5);
          attack.endAt = animStart + animDur;
          attack.gapMs = def.comboGapMs ?? 150;
          attack.recoveryMs = def.recoveryMs ?? 360;
          attack.cooldownMs = def.cooldownMs ?? 720;
          e.attackHitAt = attack.hitAt;
          e.attackEndAt = attack.endAt;
          e.vx = def.forwardImpulse ? def.forwardImpulse * e.facing : 0;
        }
        return true;
      }

      function finishWolfAttack(e, { def = null } = {}) {
        const now = performance.now();
        const attack = e.currentAttack;
        const attackDef = def || attack?.def || null;
        e.vx = 0;
        e.currentAttack = null;
        e.attackHitAt = 0;
        e.attackEndAt = 0;
        e.leapState = null;
        if (e.attackQueue && e.comboIndex < e.attackQueue.length - 1) {
          e.comboIndex += 1;
          const gap = attackDef ? (attackDef.comboGapMs ?? attackDef.landBufferMs ?? 150) : 150;
          startWolfReady(e, gap);
        } else {
          e.attackQueue = [];
          e.comboIndex = 0;
          e.state = 'recover';
          const recovery = attackDef ? (attackDef.recoveryMs ?? attackDef.landBufferMs ?? 380) : 380;
          const cooldown = attackDef ? (attackDef.cooldownMs ?? 760) : 760;
          e.stateUntil = now + recovery;
          e.nextComboAt = now + cooldown;
        }
      }

      function spawnBatHitbox(e, def, overrides = {}) {
        if (!e.combat || !def || e.dying) return null;
        const width = overrides.width ?? (typeof def.width === 'function' ? def.width(e) : def.width);
        const height = overrides.height ?? (typeof def.height === 'function' ? def.height(e) : def.height);
        const offsetDefault = typeof def.offset === 'function' ? def.offset(e) : def.offset || { x: 0, y: 0 };
        const offset = overrides.offset ?? offsetDefault;
        const duration = overrides.durationMs ?? def.durationMs ?? 120;
        const getOrigin = overrides.getOrigin || (() => ({ x: e.x, y: e.y }));
        const onHit = overrides.onHit || null;
        const onExpire = overrides.onExpire || null;
        const hitbox = Combat.spawnHitbox(e.combat, {
          shape: 'rect',
          width: width ?? 0,
          height: height ?? 0,
          offset,
          durationMs: duration,
          damage: typeof def.damage === 'function' ? def.damage(e) : def.damage ?? 0,
          poise: typeof def.poise === 'function' ? def.poise(e) : def.poise ?? 0,
          getOrigin,
          getFacing: () => e.facing,
          meta: { enemy: 'bat', attack: 'contact' },
          onHit,
          onExpire
        });
        return hitbox;
      }

      function assignWolfPackRoles() {
        const wolves = enemies.filter(en => en.type === 'wolf' && !en.dead && !en.dying);
        if (wolves.length === 0) return;
        const playerX = playerSprite.sprite?.position.x ?? 0;
        let leader = null;
        let best = Infinity;
        for (const wolf of wolves) {
          const dist = Math.abs(wolf.x - playerX);
          if (dist < best) { leader = wolf; best = dist; }
        }
        wolves.forEach(w => { w.packRole = 'support'; });
        if (leader) leader.packRole = 'leader';
        const left = wolves.filter(w => w !== leader && w.x <= playerX)
          .sort((a, b) => Math.abs(a.x - playerX) - Math.abs(b.x - playerX));
        if (left.length > 0) left[0].packRole = 'flankLeft';
        const right = wolves.filter(w => w !== leader && w.x > playerX)
          .sort((a, b) => Math.abs(a.x - playerX) - Math.abs(b.x - playerX));
        if (right.length > 0) right[0].packRole = 'flankRight';
      }

      async function loadEnemySheet(e, name, url, fps, loop, computeBaseline) {
        const { ok, img, w: sheetW, h: sheetH } = await loadImage(url);
        if (!ok) return;
        const frames = Math.max(1, Math.round(sheetW / sheetH));
        const frameW = Math.floor(sheetW / frames);
        const frameH = sheetH;
        if (computeBaseline) {
          const baselinePx = await detectBaselinePx(img, sheetW, sheetH, frames, frameW, frameH);
          const baselineUnits = baselinePx / PPU;
          if (!e.baselines) e.baselines = {};
          e.baselines[name] = baselineUnits;
          if (!e._baselineInit) {
            e.baselineUnits = baselineUnits;
            e._baselineInit = true;
          }
        }
        e.sizeUnits = frameH / PPU;
        const mgr = new BABYLON.SpriteManager(`${e.type}_${name}`, url, 1, { width: frameW, height: frameH }, scene);
        mgr.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
        mgr.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        mgr.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        e.mgr[name] = { mgr, frames, fps, loop };
      }

      function setEnemyAnim(e, name, opts = {}) {
        const meta = e.mgr[name];
        if (!meta) return;
        const force = !!opts.force;
        if (!force && e.anim === name && e.sprite) return;
        const preserveAnchor = !!opts.preserveAnchor;
        const anchorOverride = opts.anchor || null;
        const pos = e.sprite ? e.sprite.position.clone() : new BABYLON.Vector3(e.x, e.y, 0);
        let footY = null;
        if (!preserveAnchor) {
          const prevBaseline = e.baselineUnits;
          const prevCenterY = pos.y;
          footY = prevBaseline != null ? (prevCenterY - (e.sizeUnits * 0.5) + prevBaseline) : null;
        }
        if (e.sprite) e.sprite.dispose();
        const nextBaseline = e.baselines?.[name];
        if (nextBaseline != null) {
          e.baselineUnits = nextBaseline;
          if (!preserveAnchor && footY != null) {
            const newCenter = footY + (e.sizeUnits * 0.5) - e.baselineUnits;
            e.y = newCenter;
            pos.y = newCenter;
          }
        }
        if (preserveAnchor) {
          const anchor = anchorOverride || e.anchor || { x: e.x, y: e.y };
          if (anchor.x != null) pos.x = anchor.x;
          if (anchor.y != null) pos.y = anchor.y;
          e.x = pos.x;
          e.y = pos.y;
          if (!e.anchor) e.anchor = { x: pos.x, y: pos.y };
          else {
            e.anchor.x = pos.x;
            e.anchor.y = pos.y;
          }
        }
        const sp = new BABYLON.Sprite(`${e.type}_${name}`, meta.mgr);
        sp.size = e.sizeUnits;
        sp.position = pos;
        sp.invertU = (e.facing < 0);
        sp.color = new BABYLON.Color4(1, 1, 1, 1);
        sp.playAnimation(0, meta.frames - 1, meta.loop, 1000 / meta.fps);
        e.sprite = sp;
        e.anim = name;
        e.animStart = performance.now();
        e.animDur = (meta.frames / meta.fps) * 1000;
        if (preserveAnchor && e.anchor) {
          e.anchor.x = sp.position.x;
          e.anchor.y = sp.position.y;
        }
      }

      function finalizeWolfDeath(e, now = performance.now()) {
        if (!e || e.dead) return;
        e.pendingLandingState = null;
        e.dying = false;
        e.dead = true;
        e.state = 'dead';
        e.vx = 0;
        e.vy = 0;
        e.onGround = true;
        e.deathAt = e.deathAt || now;
        e.fadeStartAt = e.fadeStartAt || (e.deathAt + (e.fadeDelayMs ?? ENEMY_FADE_DELAY_MS));
        e.leapState = null;
        e.attackQueue = [];
        e.currentAttack = null;
        if (e.mgr.dead) setEnemyAnim(e, 'dead');
      }

      function finalizeBatDeath(e, now = performance.now()) {
        if (!e || e.dead) return;
        e.pendingLandingState = null;
        e.dying = false;
        e.dead = true;
        e.state = 'dead';
        e.vx = 0;
        e.vy = 0;
        e.deathAt = e.deathAt || now;
        e.fadeStartAt = e.fadeStartAt || (e.deathAt + (e.fadeDelayMs ?? ENEMY_FADE_DELAY_MS));
        e.attackStartedAt = 0;
        e.attackDidDamage = false;
        if (e.mgr.dead) setEnemyAnim(e, 'dead');
      }
    async function spawnWolf(x, footY, minX, maxX) {
        const e = {
          type: 'wolf', mgr: {}, x, y: 0, vx: 0, vy: 0, facing: 1,
          onGround: true, anim: '', patrolMin: minX, patrolMax: maxX, dir: 1,
          gravity: -20, baselineUnits: 0, sizeUnits: 1,
          hpMax: 38, hp: 38, poiseThreshold: 25, poise: 25,
          state: 'patrol', playerSeen: false, packRole: 'support',
          attackQueue: [], comboIndex: 0, currentAttack: null,
          attackHitAt: 0, attackEndAt: 0, readyUntil: 0, stateUntil: 0,
          nextComboAt: 0, leapState: null, hitReactUntil: 0,
          staggered: false, staggerUntil: 0,
          pendingLandingState: null,
          dying: false, deathAt: 0, fadeStartAt: 0, fadeDone: false,
          fadeDelayMs: ENEMY_FADE_DELAY_MS, fadeDurationMs: ENEMY_FADE_DURATION_MS,
          dead: false, combat: null, hurtbox: null
        };
        await loadEnemySheet(e, 'run', 'assets/sprites/wolf/Run.png', 14, true, true);
        await loadEnemySheet(e, 'ready', 'assets/sprites/wolf/Ready.png', 12, true);
        await loadEnemySheet(e, 'bite', 'assets/sprites/wolf/Bite.png', 12, false, true);
        await loadEnemySheet(e, 'claw', 'assets/sprites/wolf/Claw.png', 12, false, true);
        await loadEnemySheet(e, 'hit', 'assets/sprites/wolf/Hit.png', 12, false, true);
        await loadEnemySheet(e, 'dead', 'assets/sprites/wolf/Dead.png', 12, false, true);
        await loadEnemySheet(e, 'jumpUp', 'assets/sprites/wolf/JumpUp.png', 14, false);
        await loadEnemySheet(e, 'jumpMid', 'assets/sprites/wolf/JumpMid.png', 14, false);
        await loadEnemySheet(e, 'jumpDown', 'assets/sprites/wolf/JumpDown.png', 14, false);
        e.y = centerFromFoot(e, footY);
        e.nextComboAt = performance.now() + 600;
        setEnemyAnim(e, 'run');
        const box = BABYLON.MeshBuilder.CreateBox(`dbg_${e.type}`, { width: e.sizeUnits, height: e.sizeUnits, depth: 0.01 }, scene);
        const mat = new BABYLON.StandardMaterial('dbgMatWolf', scene);
        mat.wireframe = true; mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        box.material = mat; box.isVisible = enemyDbg; box.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const dt = new BABYLON.DynamicTexture(`lbl_${e.type}`, { width: 160, height: 48 }, scene, false);
        dt.hasAlpha = true;
        const lmat = new BABYLON.StandardMaterial('lblMatWolf', scene);
        lmat.diffuseTexture = dt; lmat.emissiveColor = new BABYLON.Color3(1, 1, 0); lmat.backFaceCulling = false;
        const plane = BABYLON.MeshBuilder.CreatePlane(`lbl_${e.type}`, { size: 1.5 }, scene);
        plane.material = lmat; plane.isVisible = enemyDbg; plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const ctx = dt.getContext();
        e.debugMesh = box; e.debugLabel = { mesh: plane, tex: dt, ctx, w: 160, h: 48 };

        const actorId = `wolf_${enemies.length}_${Date.now().toString(36)}`;
        const combatActor = Combat.registerActor({
          id: actorId,
          team: 'enemy',
          hpMax: e.hpMax,
          hp: e.hpMax,
          poiseThreshold: e.poiseThreshold,
          staggerDurationMs: 620,
          poiseResetDelayMs: 1600,
          poiseRegenPerSec: 18,
          getPosition: () => ({ x: e.x, y: e.y }),
          getFacing: () => e.facing,
          onHealthChange: (hp) => { e.hp = hp; },
          onPoiseChange: (poise) => { e.poise = poise; },
          onDamage: (event) => {
            const now = performance.now();
            e.lastHitAt = now;
            if (e.dying || e.dead || event?.staggered) return;
            e.attackQueue = [];
            e.comboIndex = 0;
            e.currentAttack = null;
            e.readyUntil = 0;
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            if (e.state === 'leap' && !e.onGround) {
              e.pendingLandingState = { type: 'hit', until: now + 240 };
              e.hitReactUntil = now + 240;
              e.nextComboAt = Math.max(e.nextComboAt, now + 600);
              return;
            }
            e.leapState = null;
            e.vx = 0;
            e.vy = 0;
            e.state = 'hit';
            e.hitReactUntil = now + 240;
            e.stateUntil = e.hitReactUntil;
            e.nextComboAt = Math.max(e.nextComboAt, now + 600);
            if (e.mgr.hit) setEnemyAnim(e, 'hit');
          },
          onStagger: () => {
            const now = performance.now();
            e.staggered = true;
            e.staggerUntil = combatActor.staggeredUntil;
            e.attackQueue = [];
            e.comboIndex = 0;
            e.currentAttack = null;
            e.readyUntil = 0;
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            if (e.state === 'leap' && !e.onGround) {
              e.pendingLandingState = { type: 'stagger', until: combatActor.staggeredUntil };
              e.nextComboAt = Math.max(e.nextComboAt, now + 600);
              return;
            }
            e.vx = 0; e.vy = 0;
            e.state = 'stagger';
            if (e.mgr.hit) setEnemyAnim(e, 'hit');
            e.nextComboAt = Math.max(e.nextComboAt, now + 600);
          },
          onStaggerEnd: ({ now }) => {
            e.staggered = false;
            e.staggerUntil = 0;
            e.state = 'recover';
            e.stateUntil = now + 320;
            e.nextComboAt = Math.max(e.nextComboAt, now + 720);
            if (e.mgr.ready) setEnemyAnim(e, 'ready');
          },
          onDeath: () => {
            if (e.dead || e.dying) return;
            const now = performance.now();
            e.dying = true;
            e.deathAt = now;
            e.fadeStartAt = now + (e.fadeDelayMs ?? ENEMY_FADE_DELAY_MS);
            e.attackQueue = [];
            e.comboIndex = 0;
            e.currentAttack = null;
            e.readyUntil = 0;
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            if (e.hurtbox) Combat.setHurtboxEnabled(e.hurtbox, false);
            Combat.removeActor(combatActor);
            e.combat = null;
            e.hurtbox = null;
            if (e.state === 'leap' && !e.onGround) {
              e.pendingLandingState = { type: 'dead' };
            } else {
              finalizeWolfDeath(e, now);
            }
          }
        });
        const hb = Combat.registerHurtbox(combatActor, {
          id: `${actorId}_body`,
          shape: 'rect',
          width: e.sizeUnits * 0.58,
          height: e.sizeUnits * 0.5,
          offset: { x: 0, y: -e.sizeUnits * 0.02 }
        });
        e.combat = combatActor;
        e.hurtbox = hb;
        enemies.push(e);
      }

    async function spawnBat(x, footY, minX, maxX) {
        const e = {
          type: 'bat', mgr: {}, x, y: 0, vx: 0, vy: 0, facing: 1,
          anim: 'sleep', state: 'sleep', patrolMin: minX, patrolMax: maxX, dir: 1,
          hover: footY, baselineUnits: 0, sizeUnits: 1, bob: 0,
          hpMax: 22, hp: 22, poiseThreshold: 10, poise: 10,
          nextAttackAt: 0, attackHitAt: 0, attackEndAt: 0,
          attackHitbox: null, attackDidDamage: false, attackStartedAt: 0,
          homeX: x, hitReactUntil: 0,
          awakened: false,
          staggered: false, staggerUntil: 0,
          pendingLandingState: null,
          dying: false, deathAt: 0, fadeStartAt: 0, fadeDone: false,
          fadeDelayMs: ENEMY_FADE_DELAY_MS, fadeDurationMs: ENEMY_FADE_DURATION_MS,
          fallGravity: -26,
          dead: false, combat: null, hurtbox: null,
          anchor: { x, y: 0 },
          spawnAnchor: { x, y: 0 },
          aggro: false,
          desiredAnimName: '', desiredAnimOpts: null, desiredAnimForce: false,
          animLockUntil: 0, animLockName: null,
          pendingAnimName: '', pendingAnimOpts: null, pendingAnimForce: false
        };
        await loadEnemySheet(e, 'sleep', 'assets/sprites/bat/Sleep.png', 1, true, true);
        await loadEnemySheet(e, 'wake', 'assets/sprites/bat/WakeUp.png', 12, false, true);
        await loadEnemySheet(e, 'fly', 'assets/sprites/bat/Flying.png', 12, true, true);
        await loadEnemySheet(e, 'attack', 'assets/sprites/bat/Attack.png', 12, false, true);
        await loadEnemySheet(e, 'hit', 'assets/sprites/bat/Hit.png', 12, false, true);
        await loadEnemySheet(e, 'dead', 'assets/sprites/bat/Dead.png', 12, false, true);
        e.y = centerFromFoot(e, footY);
        e.anchor.x = e.x;
        e.anchor.y = e.y;
        e.spawnAnchor.x = e.x;
        e.spawnAnchor.y = e.y;
        e.nextAttackAt = performance.now() + 800;
        setEnemyAnim(e, 'sleep');
        const box = BABYLON.MeshBuilder.CreateBox(`dbg_${e.type}`, { width: e.sizeUnits, height: e.sizeUnits, depth: 0.01 }, scene);
        const mat = new BABYLON.StandardMaterial('dbgMatBat', scene);
        mat.wireframe = true; mat.emissiveColor = new BABYLON.Color3(0, 1, 0);
        box.material = mat; box.isVisible = enemyDbg; box.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const dt = new BABYLON.DynamicTexture(`lbl_${e.type}`, { width: 160, height: 48 }, scene, false);
        dt.hasAlpha = true;
        const lmat = new BABYLON.StandardMaterial('lblMatBat', scene);
        lmat.diffuseTexture = dt; lmat.emissiveColor = new BABYLON.Color3(1, 1, 0); lmat.backFaceCulling = false;
        const plane = BABYLON.MeshBuilder.CreatePlane(`lbl_${e.type}`, { size: 1.4 }, scene);
        plane.material = lmat; plane.isVisible = enemyDbg; plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const ctx = dt.getContext();
        e.debugMesh = box; e.debugLabel = { mesh: plane, tex: dt, ctx, w: 160, h: 48 };

        const actorId = `bat_${enemies.length}_${Date.now().toString(36)}`;
        const combatActor = Combat.registerActor({
          id: actorId,
          team: 'enemy',
          hpMax: e.hpMax,
          hp: e.hpMax,
          poiseThreshold: e.poiseThreshold,
          staggerDurationMs: 520,
          poiseResetDelayMs: 1400,
          poiseRegenPerSec: 14,
          getPosition: () => ({ x: e.x, y: e.y }),
          getFacing: () => e.facing,
          onHealthChange: (hp) => { e.hp = hp; },
          onPoiseChange: (poise) => { e.poise = poise; },
          onDamage: (event) => {
            const now = performance.now();
            e.lastHitAt = now;
            if (e.dying || e.dead || event?.staggered) return;
            e.hitReactUntil = now + 220;
            e.animLockUntil = e.hitReactUntil;
            e.animLockName = 'hit';
            if (e.mgr.hit) setEnemyAnim(e, 'hit', { preserveAnchor: true, force: true });
            if (e.attackHitbox) {
              e.attackHitbox.markRemove = true;
              e.attackHitbox = null;
            }
            e.nextAttackAt = Math.max(e.nextAttackAt, now + 480);
            e.attackDidDamage = false;
            e.attackStartedAt = 0;
          },
          onStagger: () => {
            const now = performance.now();
            e.staggered = true;
            e.staggerUntil = combatActor.staggeredUntil;
            e.state = 'stagger';
            e.vx = 0; e.vy = 0;
            e.animLockUntil = combatActor.staggeredUntil;
            e.animLockName = 'hit';
            if (e.mgr.hit) setEnemyAnim(e, 'hit', { preserveAnchor: true, force: true });
            if (e.attackHitbox) {
              e.attackHitbox.markRemove = true;
              e.attackHitbox = null;
            }
            e.nextAttackAt = Math.max(e.nextAttackAt, now + 720);
            e.attackDidDamage = false;
            e.attackStartedAt = 0;
          },
          onStaggerEnd: ({ now }) => {
            e.staggered = false;
            e.staggerUntil = 0;
            e.state = 'fly';
            e.awakened = true;
            e.animLockUntil = 0;
            e.animLockName = null;
            if (e.mgr.fly) setEnemyAnim(e, 'fly', { preserveAnchor: true, force: true });
            e.nextAttackAt = now + 520;
            e.attackDidDamage = false;
            e.attackStartedAt = 0;
          },
          onDeath: () => {
            if (e.dead || e.dying) return;
            const now = performance.now();
            e.dying = true;
            e.deathAt = now;
            e.fadeStartAt = now + (e.fadeDelayMs ?? ENEMY_FADE_DELAY_MS);
            if (e.attackHitbox) {
              e.attackHitbox.markRemove = true;
              e.attackHitbox = null;
            }
            if (e.hurtbox) Combat.setHurtboxEnabled(e.hurtbox, false);
            Combat.removeActor(combatActor);
            e.combat = null;
            e.hurtbox = null;
            e.pendingLandingState = { type: 'dead' };
            e.vx = 0;
            e.vy = -1.2;
            e.attackStartedAt = 0;
            e.attackDidDamage = false;
          }
        });
        const hb = Combat.registerHurtbox(combatActor, {
          id: `${actorId}_body`,
          shape: 'rect',
          width: e.sizeUnits * 0.46,
          height: e.sizeUnits * 0.4,
          offset: { x: 0, y: -e.sizeUnits * 0.02 }
        });
        e.combat = combatActor;
        e.hurtbox = hb;
        enemies.push(e);
      }

      function updateWolf(e, dt) {
        const now = performance.now();
        updateEnemyFade(e, now);
        if (e.fadeDone) return;
        if (e.dead) {
          if (e.sprite) {
            e.sprite.position.x = e.x;
            e.sprite.position.y = e.y;
            e.sprite.invertU = (e.facing < 0);
          }
          return;
        }
        const playerX = playerSprite.sprite?.position.x ?? 0;
        const dx = playerX - e.x;
        const absDx = Math.abs(dx);
        const dying = e.dying && !e.dead;

        e.playerSeen = e.playerSeen || absDx < 7.5;

        if (!dying && e.state === 'hit' && now >= e.hitReactUntil) {
          e.state = e.playerSeen ? 'stalk' : 'patrol';
        }

        if (!dying && e.state === 'patrol' && e.playerSeen) {
          e.state = 'stalk';
        }

        const wasOnGround = e.onGround;
        let landed = false;

        switch (e.state) {
          case 'patrol': {
            if (e.anim !== 'run' && e.mgr.run) setEnemyAnim(e, 'run');
            if (e.x < e.patrolMin + 0.1) e.dir = 1;
            if (e.x > e.patrolMax - 0.1) e.dir = -1;
            e.vx = e.dir * 1.7;
            e.facing = e.dir;
            break;
          }
          case 'stalk': {
            if (dying) { e.vx *= 0.9; break; }
            if (e.anim !== 'run' && e.mgr.run) setEnemyAnim(e, 'run');
            const targetX = computeWolfTargetX(e, playerX);
            const diff = targetX - e.x;
            const speed = absDx > 4 ? 3.3 : 2.9;
            if (Math.abs(diff) > 0.1) {
              e.vx = Math.sign(diff) * speed;
            } else {
              e.vx = 0;
            }
            e.facing = dx >= 0 ? 1 : -1;
            if (!e.pendingLandingState && e.attackQueue.length === 0 && now >= e.nextComboAt) {
              if (absDx <= 5.2) {
                const combo = chooseWolfCombo(e, absDx);
                if (combo.length > 0) {
                  e.attackQueue = combo;
                  e.comboIndex = 0;
                  e.nextComboAt = now + 200; // prevent instant reselection
                  const readyDelay = absDx > 2.6 ? 160 : 200;
                  startWolfReady(e, readyDelay);
                }
              }
            }
            break;
          }
          case 'ready': {
            e.vx = 0;
            e.vy = 0;
            e.facing = dx >= 0 ? 1 : -1;
            if (!dying && !e.pendingLandingState && now >= e.readyUntil) {
              const name = e.attackQueue[e.comboIndex];
              if (!name) {
                finishWolfAttack(e);
              } else {
                const launch = startWolfAttack(e, name);
                if (launch === 'defer') {
                  break;
                }
                if (!launch) {
                  finishWolfAttack(e);
                }
              }
            }
            if (dying || e.pendingLandingState) {
              e.attackQueue = [];
              e.comboIndex = 0;
            }
            break;
          }
          case 'attack': {
            e.facing = dx >= 0 ? 1 : -1;
            const attack = e.currentAttack;
            const def = attack?.def;
            if (!attack || !def) {
              if (!dying && !e.pendingLandingState) finishWolfAttack(e);
              break;
            }
            if (dying || e.pendingLandingState) break;
            if (!attack.spawned && attack.hitAt != null && now >= attack.hitAt) {
              spawnWolfHitbox(e, def);
              attack.spawned = true;
              e.vx *= 0.4;
            }
            if (attack.endAt != null && now >= attack.endAt) {
              finishWolfAttack(e, { def });
            }
            break;
          }
          case 'leap': {
            e.facing = dx >= 0 ? 1 : -1;
            const leap = e.leapState;
            if (!leap) {
              if (!dying && !e.pendingLandingState) finishWolfAttack(e);
            } else {
              if (e.vy > 0.3 && e.mgr.jumpUp) setEnemyAnim(e, 'jumpUp');
              else if (e.vy < -0.3 && e.mgr.jumpDown) setEnemyAnim(e, 'jumpDown');
              else if (e.mgr.jumpMid) setEnemyAnim(e, 'jumpMid');
              if (!dying && !e.pendingLandingState && now >= leap.endBy) {
                finishWolfAttack(e, { def: leap.def });
              } else if ((dying || e.pendingLandingState) && now >= leap.endBy) {
                e.leapState = null;
              }
            }
            break;
          }
          case 'recover': {
            e.vx *= 0.85;
            if (!dying && now >= e.stateUntil) {
              e.state = 'stalk';
              if (e.mgr.run) setEnemyAnim(e, 'run');
            }
            break;
          }
          case 'stagger':
          case 'hit': {
            e.vx = 0;
            e.vy = 0;
            break;
          }
          default:
            break;
        }
        if (e.state !== 'leap' && !e.onGround) {
          e.vy += e.gravity * dt;
        } else if (e.state === 'leap') {
          e.vy += e.gravity * dt;
        }

        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (!e.playerSeen && e.patrolMin !== undefined && e.patrolMax !== undefined) {
          e.x = Math.max(e.patrolMin - 0.2, Math.min(e.patrolMax + 0.2, e.x));
        }

        const ground = centerFromFoot(e, 0);
        if (e.y <= ground) {
          e.y = ground;
          if (!wasOnGround) landed = true;
          e.vy = 0;
          e.onGround = true;
        } else {
          e.onGround = false;
        }

        if (landed) {
          if (e.pendingLandingState) {
            const pending = e.pendingLandingState;
            e.pendingLandingState = null;
            e.leapState = null;
            if (pending.type === 'hit') {
              e.vx = 0;
              e.vy = 0;
              e.state = 'hit';
              e.hitReactUntil = Math.max(now + 80, pending.until || (now + 220));
              e.stateUntil = e.hitReactUntil;
              e.nextComboAt = Math.max(e.nextComboAt, now + 600);
              if (e.mgr.hit) setEnemyAnim(e, 'hit');
            } else if (pending.type === 'stagger') {
              e.vx = 0;
              e.vy = 0;
              e.state = 'stagger';
              e.staggered = true;
              e.staggerUntil = pending.until || (now + 400);
              e.stateUntil = e.staggerUntil;
              e.nextComboAt = Math.max(e.nextComboAt, now + 600);
              if (e.mgr.hit) setEnemyAnim(e, 'hit');
            } else if (pending.type === 'dead') {
              finalizeWolfDeath(e, now);
            }
          } else if (dying) {
            finalizeWolfDeath(e, now);
          }
        }

        if (e.state === 'leap' && e.leapState) {
          const leap = e.leapState;
          const minAir = leap.def?.minAirTime ?? 0;
          if ((landed && (now - leap.start) >= minAir) || (!landed && now >= leap.endBy)) {
            if (!dying && !e.pendingLandingState) {
              finishWolfAttack(e, { def: leap.def });
            } else {
              e.leapState = null;
            }
          }
        }
        if (!dying && e.state === 'recover' && e.comboIndex === 0 && e.attackQueue.length === 0 && e.onGround && now >= e.stateUntil) {
          e.state = e.playerSeen ? 'stalk' : 'patrol';
          if (e.state === 'stalk' && e.mgr.run) setEnemyAnim(e, 'run');
        }

        if (e.sprite) {
          e.sprite.position.x = e.x;
          e.sprite.position.y = e.y;
          e.sprite.invertU = (e.facing < 0);
        }
      }

      function getCameraViewBounds() {
        const left = camera.position.x + (camera.orthoLeft ?? -ORTHO_VIEW_HEIGHT * 0.5);
        const right = camera.position.x + (camera.orthoRight ?? ORTHO_VIEW_HEIGHT * 0.5);
        const top = camera.position.y + (camera.orthoTop ?? ORTHO_VIEW_HEIGHT * 0.5);
        const bottom = camera.position.y + (camera.orthoBottom ?? -ORTHO_VIEW_HEIGHT * 0.5);
        return { left, right, top, bottom };
      }

      function batShouldPreserveAnchor(state) {
        return state === 'fly' || state === 'attack' || state === 'stagger' || state === 'hit';
      }

      function batSetDesiredAnim(e, name, opts = {}) {
        const finalOpts = { ...opts };
        if (finalOpts.preserveAnchor === undefined) {
          finalOpts.preserveAnchor = batShouldPreserveAnchor(name);
        }
        e.desiredAnimName = name;
        e.desiredAnimOpts = finalOpts;
        e.desiredAnimForce = !!finalOpts.force;
        if (finalOpts.force) {
          finalOpts.force = false;
        }
      }

      function batCommitDesiredAnim(e, now) {
        if (e.animLockUntil && now >= e.animLockUntil) {
          e.animLockUntil = 0;
          e.animLockName = null;
        }
        const name = e.desiredAnimName;
        if (!name) return;
        const locked = e.animLockUntil && now < e.animLockUntil;
        if (locked && e.animLockName && e.animLockName !== name) {
          return;
        }
        const opts = { ...(e.desiredAnimOpts || {}) };
        if (e.desiredAnimForce) {
          opts.force = true;
        }
        setEnemyAnim(e, name, opts);
        e.desiredAnimForce = false;
      }

      function computeHurtboxShape(box) {
        if (!box || !box.actor) return null;
        const actor = box.actor;
        const originFn = box.getOrigin || actor.getOrigin;
        const facingFn = box.getFacing || actor.getFacing;
        const origin = originFn ? originFn(actor) : { x: 0, y: 0 };
        const facing = box.mirror === false ? 1 : (facingFn ? facingFn(actor) : 1);
        const offsetX = (box.offset?.x || 0) * (box.absolute ? 1 : facing);
        const offsetY = box.offset?.y || 0;
        const center = { x: origin.x + offsetX, y: origin.y + offsetY };
        if (box.shape === 'circle') {
          const radius = Math.max(0, box.radius || 0);
          return { type: 'circle', center, radius };
        }
        const width = Math.max(0, box.width || 0);
        const height = Math.max(0, box.height || 0);
        return {
          type: 'rect',
          center,
          width,
          height,
          minX: center.x - width * 0.5,
          maxX: center.x + width * 0.5,
          minY: center.y - height * 0.5,
          maxY: center.y + height * 0.5
        };
      }

      function hurtShapesOverlap(a, b) {
        if (!a || !b) return false;
        if (a.type === 'rect' && b.type === 'rect') {
          return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
        }
        if (a.type === 'circle' && b.type === 'circle') {
          const dx = a.center.x - b.center.x;
          const dy = a.center.y - b.center.y;
          const r = a.radius + b.radius;
          return (dx * dx + dy * dy) <= r * r;
        }
        const rect = a.type === 'rect' ? a : b;
        const circle = a.type === 'circle' ? a : b;
        const clampedX = Math.max(rect.minX, Math.min(circle.center.x, rect.maxX));
        const clampedY = Math.max(rect.minY, Math.min(circle.center.y, rect.maxY));
        const dx = circle.center.x - clampedX;
        const dy = circle.center.y - clampedY;
        return (dx * dx + dy * dy) <= circle.radius * circle.radius;
      }

      function updateBat(e, dt) {
        const now = performance.now();
        updateEnemyFade(e, now);
        if (e.fadeDone) return;
        const playerSpritePos = playerSprite.sprite?.position;
        const playerX = playerSpritePos?.x ?? 0;
        const playerY = playerSpritePos?.y ?? 0;
        const dx = playerX - e.x;
        const heroSize = playerSprite.sizeUnits ?? 0;
        const heroBaseline = playerSprite.baselineUnits ?? 0;
        const heroFeetY = playerY - (heroSize * 0.5) + heroBaseline;
        const heroCenterY = heroFeetY + heroSize * 0.5;
        const detectionDist = Math.hypot(playerX - e.x, playerY - e.y);
        if (e.dead) {
          if (e.sprite) {
            e.sprite.position.x = e.x;
            e.sprite.position.y = e.y;
            e.sprite.invertU = (e.facing < 0);
          }
          return;
        }

        if (e.dying) {
          const gravity = e.fallGravity ?? -26;
          e.vy += gravity * dt;
          e.vy = Math.max(e.vy, -10);
          e.y += e.vy * dt;
          e.x += e.vx * dt;
          const ground = centerFromFoot(e, 0);
          if (e.y <= ground) {
            e.y = ground;
            e.vy = 0;
            finalizeBatDeath(e, now);
          }
          if (e.sprite) {
            e.sprite.position.x = e.x;
            e.sprite.position.y = e.y;
            e.sprite.invertU = (e.facing < 0);
          }
          if (e.anchor) {
            e.anchor.x = e.x;
            e.anchor.y = e.y;
          }
          return;
        }

        const viewBounds = getCameraViewBounds();
        const playerInView = playerX >= viewBounds.left - BAT_VIEW_MARGIN &&
          playerX <= viewBounds.right + BAT_VIEW_MARGIN &&
          playerY >= viewBounds.bottom - BAT_VIEW_MARGIN &&
          playerY <= viewBounds.top + BAT_VIEW_MARGIN;
        const heroFromSpawn = Math.hypot(playerX - e.spawnAnchor.x, playerY - e.spawnAnchor.y);
        const releaseDist = BAT_AGGRO_RADIUS + BAT_AGGRO_HYSTERESIS;
        const shouldAggro = playerInView && detectionDist <= BAT_AGGRO_RADIUS;
        if (shouldAggro) {
          e.aggro = true;
          e.awakened = true;
        }
        const leashBreak = heroFromSpawn > BAT_LEASH_RADIUS;
        if (e.aggro && (detectionDist > releaseDist || !playerInView || leashBreak)) {
          e.aggro = false;
          e.nextAttackAt = Math.max(e.nextAttackAt, now + BAT_ATTACK_COOLDOWN_MS);
          if (e.attackHitbox) {
            e.attackHitbox.markRemove = true;
            e.attackHitbox = null;
          }
        }

        if (e.hitReactUntil && now >= e.hitReactUntil) {
          e.hitReactUntil = 0;
        }

        switch (e.state) {
          case 'sleep': {
            batSetDesiredAnim(e, 'sleep', { preserveAnchor: false });
            e.vx = 0;
            e.vy = 0;
            e.x += (e.homeX - e.x) * 0.08;
            e.y = centerFromFoot(e, e.hover);
            if ((e.awakened || shouldAggro) && now >= e.nextAttackAt) {
              e.state = 'wake';
              e.awakened = true;
              e.nextAttackAt = now + 200;
              batSetDesiredAnim(e, 'wake', { preserveAnchor: false, force: true });
            }
            break;
          }
          case 'wake': {
            batSetDesiredAnim(e, 'wake', { preserveAnchor: false });
            e.y = centerFromFoot(e, e.hover);
            if (now >= (e.animStart + e.animDur - 1)) {
              e.state = 'fly';
              e.awakened = true;
              e.nextAttackAt = now + 420;
              batSetDesiredAnim(e, 'fly', { force: true });
            }
            break;
          }
          case 'fly': {
            batSetDesiredAnim(e, 'fly');
            e.bob += dt * 2.2;
            const baseClampMin = e.patrolMin ?? (e.homeX - 3);
            const baseClampMax = e.patrolMax ?? (e.homeX + 3);
            const leashClampMin = e.spawnAnchor.x - (BAT_LEASH_RADIUS - 0.25);
            const leashClampMax = e.spawnAnchor.x + (BAT_LEASH_RADIUS - 0.25);
            const clampMin = e.aggro ? leashClampMin : baseClampMin;
            const clampMax = e.aggro ? leashClampMax : baseClampMax;
            const minCenter = centerFromFoot(e, -0.1);
            const maxCenter = centerFromFoot(e, e.hover + BAT_REBOUND_MAX_ABOVE_HOVER);
            const bobValue = Math.sin(e.bob) * 0.35;
            let targetX = e.aggro
              ? Math.max(clampMin, Math.min(clampMax, playerX))
              : Math.max(clampMin, Math.min(clampMax, e.spawnAnchor.x));
            const idleCenter = Math.max(minCenter, Math.min(maxCenter, centerFromFoot(e, e.hover + bobValue)));
            const pursuitAim = Math.max(minCenter, Math.min(maxCenter, heroCenterY + BAT_FOLLOW_Y_OFFSET));
            const pursuitCenter = Math.max(minCenter, Math.min(maxCenter, pursuitAim + bobValue * 0.25));
            const desiredCenter = e.aggro ? pursuitCenter : idleCenter;
            const toX = targetX - e.x;
            const maxSpeed = e.aggro ? BAT_FOLLOW_SPEED : BAT_RETURN_SPEED;
            let desiredVX = 0;
            if (Math.abs(toX) > 0.01) {
              desiredVX = (toX / Math.abs(toX)) * maxSpeed;
            }
            const accel = e.aggro ? BAT_FOLLOW_ACCEL : BAT_RETURN_ACCEL;
            const blend = Math.min(1, accel * dt);
            e.vx += (desiredVX - e.vx) * blend;
            e.x += e.vx * dt;
            const prevY = e.y;
            if (e.aggro) {
              const dy = desiredCenter - e.y;
              const framesEquivalent = Math.max(0, dt * 60);
              const lerpFactor = Math.max(0, Math.min(1, 1 - Math.pow(1 - BAT_VERTICAL_LERP, framesEquivalent)));
              const desiredStep = dy * lerpFactor;
              const maxStep = BAT_VERTICAL_MAX_SPEED * dt;
              const step = Math.sign(desiredStep) * Math.min(Math.abs(desiredStep), maxStep);
              e.y += step;
            } else {
              e.y = desiredCenter;
            }
            if (dt > 0) {
              e.vy = (e.y - prevY) / dt;
            } else {
              e.vy = 0;
            }
            const leashHardMin = e.spawnAnchor.x - BAT_LEASH_RADIUS;
            const leashHardMax = e.spawnAnchor.x + BAT_LEASH_RADIUS;
            if (e.x < leashHardMin) {
              e.x = leashHardMin;
              if (e.vx < 0) e.vx = 0;
            } else if (e.x > leashHardMax) {
              e.x = leashHardMax;
              if (e.vx > 0) e.vx = 0;
            }
            if (e.y < minCenter) {
              e.y = minCenter;
              if (e.vy < 0) e.vy = 0;
            } else if (e.y > maxCenter) {
              e.y = maxCenter;
              if (e.vy > 0) e.vy = 0;
            }
            if (Math.abs(e.vx) > 0.02) {
              e.facing = e.vx >= 0 ? 1 : -1;
            } else if (e.aggro && Math.abs(dx) > 0.02) {
              e.facing = dx >= 0 ? 1 : -1;
            }
            const batHurt = computeHurtboxShape(e.hurtbox);
            const playerHurt = computeHurtboxShape(playerHurtbox);
            const overlapping = e.aggro && now >= e.nextAttackAt && batHurt && playerHurt && hurtShapesOverlap(batHurt, playerHurt);
            if (overlapping) {
              e.state = 'attack';
              e.attackStartedAt = now;
              e.attackDidDamage = false;
              if (e.attackHitbox) {
                e.attackHitbox.markRemove = true;
                e.attackHitbox = null;
              }
              e.nextAttackAt = now + BAT_ATTACK_COOLDOWN_MS;
              batSetDesiredAnim(e, 'attack', { force: true });
            }
            break;
          }
          case 'attack': {
            batSetDesiredAnim(e, 'attack');
            const attackDef = BAT_ATTACK_DATA.contact;
            const attackMeta = e.mgr.attack;
            const frames = attackMeta?.frames ?? 12;
            const animDuration = attackMeta ? (attackMeta.frames / attackMeta.fps) * 1000 : (attackDef.durationMs ?? 160);
            if (!e.attackStartedAt) e.attackStartedAt = now;
            const elapsed = Math.max(0, now - e.attackStartedAt);
            const animT = animDuration > 0 ? Math.min(1, elapsed / animDuration) : 1;
            const frameFloat = frames > 0 ? animT * frames : 0;
            const frameIndex = Math.max(0, Math.min(frames - 1, Math.floor(frameFloat)));
            const inActiveWindow = frameIndex >= BAT_ATTACK_ACTIVE_FRAMES.start && frameIndex <= BAT_ATTACK_ACTIVE_FRAMES.end;
            const frameDuration = frames > 0 ? animDuration / frames : (attackDef.durationMs ?? 120);
            e.vx += (0 - e.vx) * Math.min(1, 12 * dt);
            e.vy += (0 - e.vy) * Math.min(1, 12 * dt);
            if (Math.abs(dx) > 0.02) {
              e.facing = dx >= 0 ? 1 : -1;
            }
            if (inActiveWindow && !e.attackHitbox && !e.attackDidDamage) {
              const remainingFrames = Math.max(1, BAT_ATTACK_ACTIVE_FRAMES.end - frameIndex + 1);
              const durationMs = Math.max(attackDef.durationMs ?? 60, frameDuration * remainingFrames);
              const hitbox = spawnBatHitbox(e, attackDef, {
                durationMs,
                onHit: () => {
                  e.attackDidDamage = true;
                  if (e.attackHitbox === hitbox) {
                    e.attackHitbox.markRemove = true;
                    e.attackHitbox = null;
                  }
                },
                onExpire: () => {
                  if (e.attackHitbox === hitbox) {
                    e.attackHitbox = null;
                  }
                }
              });
              e.attackHitbox = hitbox;
            } else if ((!inActiveWindow || e.attackDidDamage) && e.attackHitbox) {
              e.attackHitbox.markRemove = true;
              e.attackHitbox = null;
            }
            if (animT >= 1) {
              e.state = 'fly';
              e.attackStartedAt = 0;
              e.attackDidDamage = false;
              if (e.attackHitbox) {
                e.attackHitbox.markRemove = true;
                e.attackHitbox = null;
              }
            }
            break;
          }
          case 'stagger': {
            batSetDesiredAnim(e, 'hit', { preserveAnchor: true });
            e.vx = 0;
            e.vy = 0;
            break;
          }
          case 'hit': {
            batSetDesiredAnim(e, 'hit', { preserveAnchor: true });
            break;
          }
          default:
            break;
        }

        if (e.attackHitbox && e.state !== 'attack') {
          e.attackHitbox.markRemove = true;
          e.attackHitbox = null;
        }

        if (e.state !== 'attack') {
          e.attackStartedAt = 0;
          e.attackDidDamage = false;
        }

        if (e.anchor) {
          e.anchor.x = e.x;
          e.anchor.y = e.y;
        }

        batCommitDesiredAnim(e, now);

        if (e.sprite) {
          e.sprite.position.x = e.x;
          e.sprite.position.y = e.y;
          e.sprite.invertU = (e.facing < 0);
        }
      }


      function updateEnemies(dt) {
        assignWolfPackRoles();
        enemies.forEach(e => {
          if (!e.sprite) return;
          if (e.type === 'wolf') updateWolf(e, dt); else updateBat(e, dt);
          if (e.debugMesh) {
            e.debugMesh.position.x = e.x;
            e.debugMesh.position.y = e.y;
            e.debugMesh.isVisible = enemyDbg && !e.fadeDone;
          }
          if (e.debugLabel) {
            const lbl = e.debugLabel;
            lbl.mesh.position.x = e.x;
            lbl.mesh.position.y = e.y + e.sizeUnits * 0.6;
            if (enemyDbg && !e.fadeDone) {
              const texW = lbl.w || 160;
              const texH = lbl.h || 48;
              lbl.ctx.clearRect(0, 0, texW, texH);
              lbl.ctx.fillStyle = '#ffff00';
              lbl.ctx.font = '16px monospace';
              const status = e.dead ? 'dead' : (e.state || e.anim);
              lbl.ctx.fillText(status, 2, 18);
              const hpLine = `HP:${Math.max(0, Math.round(e.hp ?? 0)).toString().padStart(3)} PO:${Math.max(0, Math.round(e.poise ?? 0)).toString().padStart(2)}`;
              const hpY = Math.min(texH - 14, 34);
              lbl.ctx.fillText(hpLine, 2, hpY);
              if (e.packRole) {
                const roleY = Math.min(texH - 2, hpY + 16);
                lbl.ctx.fillText(`Role:${e.packRole}`, 2, roleY);
              }
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
      spawnBat(4, 1.6, 3, 8);

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
      state.flaskStart = now;
      state.flaskEndAt = now + stats.flaskSip * 1000;
      state.flaskHealApplied = false;
      stats.flaskLock = now + stats.flaskRollCancel * 1000;
      if (playerSprite.mgr.idle) setAnim('idle', true);
      playHealFx();
      playHealFlash();
    }

    function startRoll() {
      if (state.dead || state.rolling) return;
      const flasking = state.flasking;
      if (state.acting && !flasking) return;
      if (stats.stam < stats.rollCost) return;
      if (flasking) {
        if (!state.flaskHealApplied) return;
        cleanupFlaskState();
      }
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
      combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
      setAnim(name, false);
      const now = performance.now();
      combo.endAt = now + playerSprite.animDurationMs;
      combo.cancelAt = now + playerSprite.animDurationMs * (meta.cancelFrac ?? 0.6);
      const attackDef = PLAYER_ATTACKS[name];
      if (attackDef) {
        const animDur = playerSprite.animDurationMs || ((meta.frames / meta.fps) * 1000);
        const frac = attackDef.hitFrac ?? 0.45;
        combo.pendingHit = true;
        combo.hitAt = now + animDur * frac;
        combo.hitMeta = { attackId: name, stage };
      }
      return true;
    }
    function tryStartLight() {
      if (state.dead || state.rolling || state.blocking) return;
      if (combo.stage > 0) { combo.queued = true; return; }
      startLightStage(1);
    }

    function resetHeavyState({ keepActing = false } = {}) {
      heavy.charging = false;
      heavy.releasing = false;
      heavy.chargeStart = 0;
      heavy.chargeHoldMs = 0;
      heavy.minChargeAt = 0;
      heavy.maxChargeAt = 0;
      heavy.staminaSpent = false;
      heavy.charged = false;
      heavy.chargeRatio = 0;
      heavy.pendingHit = false;
      heavy.hitAt = 0;
      heavy.hitApplied = false;
      heavy.hitMeta = null;
      heavy.releaseDamage = 0;
      heavy.releaseStagger = 0;
      combo.pendingHit = false;
      combo.hitMeta = null;
      combo.hitAt = 0;
      if (!keepActing) state.acting = false;
    }

    function startHeavyCharge() {
      if (heavy.charging || heavy.releasing) return;
      if (state.dead || state.rolling || state.blocking) return;
      if (!state.onGround) return;
      if (state.acting && !state.flasking) return;
      if (!playerSprite.mgr.heavy) return;
      if (stats.stam < stats.heavyCost) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      state.flasking = false;
      state.acting = true;
      combo.stage = 0; combo.queued = false; combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
      const now = performance.now();
      heavy.charging = true;
      heavy.releasing = false;
      heavy.chargeStart = now;
      heavy.chargeHoldMs = 0;
      heavy.minChargeAt = now + HEAVY_CHARGE_MIN_MS;
      heavy.maxChargeAt = now + HEAVY_CHARGE_MAX_MS;
      heavy.staminaSpent = false;
      heavy.charged = false;
      heavy.chargeRatio = 0;
      heavy.pendingHit = false;
      heavy.hitApplied = false;
      heavy.hitMeta = null;
      heavy.releaseDamage = stats.heavyDamage;
      heavy.releaseStagger = stats.heavyStagger;
      if (playerSprite.mgr.heavy) {
        setAnim('heavy', false, { play: false, frame: 0, manualDuration: 0 });
      }
    }

    function releaseHeavyCharge() {
      if (!heavy.charging) return;
      const now = performance.now();
      const holdMs = now - heavy.chargeStart;
      heavy.chargeHoldMs = holdMs;
      heavy.chargeRatio = Math.max(0, Math.min(1, holdMs / HEAVY_CHARGE_MAX_MS));
      if (!heavy.staminaSpent) {
        if (stats.stam < stats.heavyCost) {
          resetHeavyState();
          return;
        }
        setST(stats.stam - stats.heavyCost);
        heavy.staminaSpent = true;
      }
      heavy.charging = false;
      heavy.releasing = true;
      state.flasking = false;
      heavy.charged = holdMs >= HEAVY_CHARGE_MIN_MS;
      heavy.releaseDamage = stats.heavyDamage + (heavy.charged ? stats.heavyChargeBonusDamage : 0);
      heavy.releaseStagger = stats.heavyStagger + (heavy.charged ? stats.heavyChargeBonusStagger : 0);
      heavy.lastHoldMs = holdMs;
      heavy.lastDamage = heavy.releaseDamage;
      heavy.lastStagger = heavy.releaseStagger;
      if (playerSprite.mgr.heavy) setAnim('heavy', false);
      const releaseStart = performance.now();
      const animDur = playerSprite.animDurationMs;
      heavy.hitAt = releaseStart + Math.max(0, animDur * HEAVY_HIT_FRAC);
      heavy.pendingHit = animDur > 0;
      heavy.hitApplied = false;
      heavy.hitMeta = {
        type: 'heavy',
        attackId: 'heavy',
        charged: heavy.charged,
        hitstopMs: HITSTOP_HEAVY_MS + (heavy.charged ? HITSTOP_HEAVY_CHARGED_BONUS_MS : 0),
        shakeMagnitude: CAMERA_SHAKE_MAG * (heavy.charged ? 1.4 : 1.0),
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS * (heavy.charged ? 1.2 : 1),
        damage: heavy.releaseDamage,
        stagger: heavy.releaseStagger
      };
      actionEndAt = releaseStart + animDur;
      if (!heavy.pendingHit && heavy.hitMeta) {
        onPlayerAttackLand(heavy.hitMeta);
        heavy.hitMeta = null;
        heavy.hitApplied = true;
      }
    }

    // Hurt + Death
    function triggerHurt(dmg = 15, opts = {}) {
      if (state.dead) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      resetHeavyState({ keepActing: true });
      if (!opts.alreadyApplied) setHP(stats.hp - dmg);
      applyImpactEffects({ hitstopMs: HITSTOP_HURT_MS, shakeMagnitude: CAMERA_SHAKE_MAG * 1.05, shakeDurationMs: CAMERA_SHAKE_DURATION_MS * 1.1 });
      if (stats.hp <= 0) { die(); return; }
      state.flasking = false;
      state.acting = true; combo.stage = 0; combo.queued = false;
      combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
      setAnim('hurt', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }
    function die() {
      if (state.dead) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      resetHeavyState({ keepActing: true });
      state.dead = true; state.acting = true; state.flasking = false; state.vx = 0; state.vy = 0;
      state.blocking = false; state.parryOpen = false;
      combo.stage = 0; combo.queued = false; combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
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
        if (playerActor) {
          playerActor.alive = true;
          playerActor.hp = stats.hp;
          Combat.clearInvulnerability(playerActor);
        }
        state.dead = false; state.acting = false; state.flasking = false;
        resetHeavyState();
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
    function toggleCameraShake() {
      cameraShake.enabled = !cameraShake.enabled;
      if (!cameraShake.enabled) {
        cameraShake.active = false;
        cameraShake.offsetX = 0;
        cameraShake.offsetY = 0;
      }
      console.log('Camera micro-shake', cameraShake.enabled ? 'ON' : 'OFF');
    }
    const overlayEl = document.getElementById('overlay');
    let overlayShow = false;
    function toggleOverlay() { overlayShow = !overlayShow; overlayEl.style.display = overlayShow ? 'block' : 'none'; }
    function updateOverlay() {
      if (!overlayShow) return;
      const now = performance.now();
      const parryRemain = Math.max(0, state.parryUntil - now);
      const heavyHoldMs = heavy.charging ? heavy.chargeHoldMs : heavy.lastHoldMs;
      const heavyHoldSec = heavyHoldMs / 1000;
      const heavyDmg = heavy.releasing ? heavy.releaseDamage : (heavy.lastDamage || stats.heavyDamage);
      const heavyStag = heavy.releasing ? heavy.releaseStagger : (heavy.lastStagger || stats.heavyStagger);
      const heavyChargedDisplay = heavy.charging ? heavy.charged : (heavy.lastHoldMs >= HEAVY_CHARGE_MIN_MS && heavy.lastHoldMs > 0);
      const hitstopMs = hitstopRemaining(now);
      overlayEl.textContent =
        `FPS:${engine.getFps().toFixed(0)}  Cam:ORTHO h=${ORTHO_VIEW_HEIGHT}\n` +
        `Anim:${playerSprite.state} loop:${playerSprite.loop}  size:${playerSprite.sizeUnits?.toFixed(2)} base:${playerSprite.baselineUnits?.toFixed(3)}\n` +
        `Y:${playerSprite.sprite?.position.y.toFixed(2)} FeetCenter:${feetCenterY().toFixed(2)} Ground:0 Air:${!state.onGround}\n` +
        `HP:${Math.round(stats.hp)}/${stats.hpMax}  ST:${Math.round(stats.stam)}  Dead:${state.dead}  Climb:${state.climbing}\n` +
        `Block:${state.blocking}  ParryOpen:${state.parryOpen} (${parryRemain.toFixed(0)}ms)\n` +
        `vx:${state.vx.toFixed(2)} vy:${state.vy.toFixed(2)}  Roll:${state.rolling} Acting:${state.acting} Combo(stage:${combo.stage} queued:${combo.queued})\n` +
        `Heavy:charging:${heavy.charging} releasing:${heavy.releasing} hold:${heavyHoldSec.toFixed(2)}s ratio:${heavy.chargeRatio.toFixed(2)} charged:${heavyChargedDisplay} dmg:${heavyDmg.toFixed(0)} stag:${heavyStag.toFixed(2)}\n` +
        `Hitstop:${hitstopMs.toFixed(0)}ms  CamShake:${cameraShake.enabled} (active:${cameraShake.active})\n` +
        (enemyDbg ? enemies.map((e,i)=>`E${i}:${e.type} st:${e.state||e.anim} x:${e.x.toFixed(2)} y:${e.y.toFixed(2)}`).join('\n') + '\n' : '') +
        `[F6] camShake:${cameraShake.enabled}  |  [F7] slowMo:${slowMo}  |  [F8] colliders:${showColliders}  |  [F9] overlay  |  [F10] enemyDbg  |  A/D move, W/S climb, Space jump, L roll, tap I=Parry, hold I=Block, J light, K heavy, F flask, E interact, Shift run  |  Debug: H hurt X die`;
    }

    // === Game loop ===
    engine.runRenderLoop(() => {
      const now = performance.now();
      const rawDt = engine.getDeltaTime() / 1000;
      const baseScale = slowMo ? 0.25 : 1;
      const hitstopActive = hitstopRemaining(now) > 0;
      const dtScale = hitstopActive ? 0 : baseScale;
      const dt = rawDt * dtScale;
      applyAnimationScale(hitstopActive ? 0 : 1);

      if (heavy.charging) {
        heavy.chargeHoldMs = now - heavy.chargeStart;
        heavy.chargeRatio = Math.max(0, Math.min(1, heavy.chargeHoldMs / HEAVY_CHARGE_MAX_MS));
        heavy.charged = heavy.chargeHoldMs >= HEAVY_CHARGE_MIN_MS;
      }
      if (combo.pendingHit && now >= combo.hitAt) {
        const stageId = combo.stage || (combo.hitMeta?.stage) || 1;
        const meta = combo.hitMeta || { attackId: `light${stageId}`, stage: stageId };
        combo.pendingHit = false;
        combo.hitAt = 0;
        combo.hitMeta = null;
        onPlayerAttackLand(meta);
      }
      if (heavy.pendingHit && !heavy.hitApplied && now >= heavy.hitAt) {
        heavy.hitApplied = true;
        const meta = heavy.hitMeta || { type: 'heavy', attackId: 'heavy', charged: heavy.charged };
        onPlayerAttackLand(meta);
        heavy.pendingHit = false;
        heavy.hitMeta = null;
      }

      if (state.flasking) {
        if (!state.flaskHealApplied && now >= stats.flaskLock) {
          setHP(stats.hp + stats.hpMax * stats.flaskHealPct);
          state.flaskHealApplied = true;
        }
        if (now >= state.flaskEndAt) {
          cleanupFlaskState({ stopFx: false });
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
        const iNow = (t >= stats.iFrameStart) && (t <= stats.iFrameEnd);
        if (iNow !== state.iFramed) {
          state.iFramed = iNow;
          Combat.setInvulnerable(playerActor, 'roll', state.iFramed);
        }
        if (state.rollT >= stats.rollDur) {
          state.rolling = false;
          if (state.iFramed) {
            state.iFramed = false;
            Combat.setInvulnerable(playerActor, 'roll', false);
          }
        }
      } else if (state.iFramed) {
        state.iFramed = false;
        Combat.setInvulnerable(playerActor, 'roll', false);
      }

      // Light/Heavy/Flask/Debug
      if (Keys.light) { tryStartLight(); Keys.light = false; }
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
          combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
          state.acting = false;
        }
      }
      // Handle generic action end (hurt, heavy, parry, death)
      if (state.acting && actionEndAt && now >= actionEndAt) {
        if (state.dead) startRespawn();
        else if (state.flasking) cleanupFlaskState();
        else state.acting = false;
        if (heavy.releasing || heavy.pendingHit) {
          heavy.releasing = false;
          heavy.pendingHit = false;
          heavy.hitMeta = null;
          heavy.hitApplied = false;
          heavy.staminaSpent = false;
          heavy.chargeStart = 0;
          heavy.chargeHoldMs = 0;
          heavy.chargeRatio = 0;
          heavy.charged = false;
        }
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
        const playerSp = playerSprite.sprite;
        if (playerSp) {
          healFx.sprite.position.x = playerSp.position.x;
          healFx.sprite.position.y = playerSp.position.y;
          healFx.sprite.position.z = playerSp.position.z - HEAL_FX_FRONT_OFFSET;
          if (typeof playerSp.renderingGroupId === 'number') {
            healFx.sprite.renderingGroupId = playerSp.renderingGroupId;
          }
        } else {
          healFx.sprite.position.x = placeholder.position.x;
          healFx.sprite.position.y = placeholder.position.y;
          const baseZ = (typeof placeholder.position.z === 'number') ? placeholder.position.z : 0;
          healFx.sprite.position.z = baseZ - HEAL_FX_FRONT_OFFSET;
        }
        if (!state.flasking && healFx.animStart && now >= healFx.animStart + healFx.animDuration) {
          stopHealFx();
        }
      }
      updateHealFlash(now);

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

      // Camera follow (x only) + micro-shake offset
      updateCameraShake(now);
      const shakeX = cameraShake.offsetX;
      const shakeY = cameraShake.offsetY;
      camera.position.x = placeholder.position.x + shakeX;
      camera.position.y = CAMERA_BASE_POS_Y + shakeY;
      cameraTarget.x = placeholder.position.x + shakeX;
      cameraTarget.y = CAMERA_BASE_TARGET_Y + shakeY;
      camera.setTarget(cameraTarget);

      // Stamina regen (disabled during actions/roll/death)
      const busy = state.rolling || state.acting || state.dead;
      if (!busy && stats.stam < stats.stamMax) setST(stats.stam + stats.stamRegenPerSec * dt);
      updateEnemies(dt);
      Combat.update(dt, now);
      updateOverlay();
      scene.render();
    });

    window.addEventListener('resize', () => { engine.resize(); fitOrtho(); });

    if (typeof window !== 'undefined') window.EotRCombat = Combat;

    console.log('[EotR] Phase 2.3.1 (Parry/Block bugfix) boot OK');
  } catch (err) {
    console.error('Boot error:', err);
    alert('Boot error (see console for details).');
  }
})();