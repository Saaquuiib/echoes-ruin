// Echoes of the Ruin — Phase 2.3.1
// Fix: non-looping anims sticking; input polish
// Uses global BABYLON from CDN (no tooling)

(() => {
  // ====== Tunables / Fallbacks ======
  const PPU = 32;                       // pixels per world unit
  const MAX_FRAME_DT = 1 / 30;          // cap dt for gameplay stability per design requirement
  const FALLBACK_BASELINE_PX = 6;       // if pixel-read fails
  const ORTHO_VIEW_HEIGHT = 12;         // vertical world units in view
  const LANDING_MIN_GROUNDED_MS = 45;   // delay landing anim until on-ground persisted briefly
  const LANDING_SPAM_GRACE_MS = 160;    // suppress landing anim if jump pressed again within this window
  const HERO_TORSO_FRAC = 0.28;         // relative height (feet->head) where torso FX center should sit

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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function snapToPixel(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * PPU) / PPU;
  }

  // Scan bottom-most opaque pixel across all frames to compute baseline (empty rows below feet)
  async function detectBaselinePx(image, sheetW, sheetH, frames, frameW, frameH) {
    const fallback = {
      baselinePx: FALLBACK_BASELINE_PX,
      bottomOpaqueY: frameH > 0 ? frameH - 1 : 0,
      bottomLeftPx: 0,
      bottomRightPx: Math.max(0, frameW - 1),
      leftPx: 0,
      rightPx: Math.max(0, frameW - 1)
    };
    try {
      const c = document.createElement('canvas');
      c.width = sheetW; c.height = sheetH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, sheetW, sheetH);
      ctx.drawImage(image, 0, 0);

      const data = ctx.getImageData(0, 0, sheetW, sheetH).data;
      let maxBottomOpaqueY = -1;
      let bottomLeftPx = frameW;
      let bottomRightPx = -1;
      let leftPx = frameW;
      let rightPx = -1;

      for (let f = 0; f < frames; f++) {
        const x0 = f * frameW;
        for (let y = frameH - 1; y >= 0; y--) {
          const rowOffset = (y * sheetW + x0) * 4;
          let rowMin = frameW;
          let rowMax = -1;
          for (let x = 0; x < frameW; x++) {
            const idx = rowOffset + x * 4;
            if (data[idx + 3] !== 0) {
              rowMin = Math.min(rowMin, x);
              rowMax = Math.max(rowMax, x);
              leftPx = Math.min(leftPx, x);
              rightPx = Math.max(rightPx, x);
            }
          }
          if (rowMax >= rowMin) {
            if (y > maxBottomOpaqueY) {
              maxBottomOpaqueY = y;
              bottomLeftPx = rowMin;
              bottomRightPx = rowMax;
            } else if (y === maxBottomOpaqueY) {
              bottomLeftPx = Math.min(bottomLeftPx, rowMin);
              bottomRightPx = Math.max(bottomRightPx, rowMax);
            }
          }
        }
      }
      if (maxBottomOpaqueY < 0) return fallback;
      return {
        baselinePx: (frameH - 1) - maxBottomOpaqueY,
        bottomOpaqueY: maxBottomOpaqueY,
        bottomLeftPx: bottomLeftPx < frameW ? bottomLeftPx : 0,
        bottomRightPx: bottomRightPx >= 0 ? bottomRightPx : Math.max(0, frameW - 1),
        leftPx: leftPx < frameW ? leftPx : 0,
        rightPx: rightPx >= 0 ? rightPx : Math.max(0, frameW - 1)
      };
    } catch {
      return fallback;
    }
  }

  const SPRITE_FLASH_DURATION_MS = 100;
  const SPRITE_FLASH_RESET_MS = 16;
  const SPRITE_FLASH_INTENSITY = 5;
  const SpriteFlash = (() => {
    const states = new Map();

    function cloneColor(color) {
      if (!color) return new BABYLON.Color4(1, 1, 1, 1);
      if (typeof color.clone === 'function') return color.clone();
      const r = color.r ?? color.red ?? color.x ?? 1;
      const g = color.g ?? color.green ?? color.y ?? 1;
      const b = color.b ?? color.blue ?? color.z ?? 1;
      const a = color.a ?? color.alpha ?? color.w ?? 1;
      return new BABYLON.Color4(r, g, b, a);
    }

    function spriteDisposed(sprite) {
      if (!sprite) return true;
      const fn = typeof sprite.isDisposed === 'function' ? sprite.isDisposed : null;
      return fn ? fn.call(sprite) : false;
    }

    function applyFlash(sprite, entry) {
      if (!sprite || spriteDisposed(sprite)) return;
      const base = entry.baseColor || new BABYLON.Color4(1, 1, 1, 1);
      const alpha = base.a ?? 1;
      const intensity = entry.intensity ?? SPRITE_FLASH_INTENSITY;
      sprite.color = new BABYLON.Color4(intensity, intensity, intensity, alpha);
    }

    function trigger(sprite, now = performance.now(), durationMs = SPRITE_FLASH_DURATION_MS) {
      if (!sprite || spriteDisposed(sprite)) return;
      let entry = states.get(sprite);
      const base = entry?.baseColor ? cloneColor(entry.baseColor) : cloneColor(sprite.color);
      const intensity = entry?.intensity ?? SPRITE_FLASH_INTENSITY;
      const resetMs = Math.max(0, SPRITE_FLASH_RESET_MS);
      if (!entry) {
        entry = {
          baseColor: base,
          intensity,
          flashStart: now,
          until: now + durationMs
        };
        states.set(sprite, entry);
        applyFlash(sprite, entry);
        return;
      }

      entry.baseColor = base;
      entry.intensity = intensity;
      entry.flashStart = now + resetMs;
      entry.until = entry.flashStart + durationMs;
      sprite.color = cloneColor(base);
    }

    function update(now = performance.now()) {
      if (states.size === 0) return;
      for (const [sprite, entry] of states) {
        if (!sprite || spriteDisposed(sprite)) {
          states.delete(sprite);
          continue;
        }
        if (now < entry.until) {
          const base = cloneColor(entry.baseColor);
          const flashStart = entry.flashStart ?? entry.until - SPRITE_FLASH_DURATION_MS;
          if (now < flashStart) {
            sprite.color = base;
          } else {
            applyFlash(sprite, entry);
          }
        } else {
          const base = cloneColor(entry.baseColor);
          sprite.color = base;
          states.delete(sprite);
        }
      }
    }

    function setBaseColor(sprite, color, now = performance.now()) {
      if (!sprite || spriteDisposed(sprite)) return;
      const base = cloneColor(color);
      const entry = states.get(sprite);
      if (entry) {
        entry.baseColor = base;
        if (now >= entry.until) {
          sprite.color = cloneColor(base);
          states.delete(sprite);
        }
      } else {
        sprite.color = base;
      }
    }

    function isFlashing(sprite, now = performance.now()) {
      if (!sprite || spriteDisposed(sprite)) return false;
      const entry = states.get(sprite);
      return !!entry && now < entry.until;
    }

    return {
      trigger,
      update,
      setBaseColor,
      isFlashing
    };
  })();

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
      const actor = {
        id,
        team: config.team || 'neutral',
        hpMax: config.hpMax ?? config.maxHp ?? config.hp ?? 0,
        hp: config.hp ?? config.hpMax ?? config.maxHp ?? 0,
        getOrigin: config.getPosition || config.getOrigin || (() => ({ x: 0, y: 0 })),
        getFacing: config.getFacing || (() => 1),
        getSprite: typeof config.getSprite === 'function' ? config.getSprite : null,
        invulnFlags: new Map(),
        hurtboxes: new Map(),
        alive: true,
        processHit: config.processHit || null,
        onPreHit: config.onPreHit || null,
        onPostHit: config.onPostHit || null,
        onDamage: config.onDamage || null,
        onHealthChange: config.onHealthChange || null,
        onDeath: config.onDeath || null,
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
        pierce: !!config.pierce,
        friendlyFire: !!config.friendlyFire,
        ignoreInvuln: !!config.ignoreInvuln,
        applyDamage: config.applyDamage !== undefined ? !!config.applyDamage : true,
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
        return { type: 'circle', center, radius, facing, origin };
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
        maxY: center.y + height * 0.5,
        facing,
        origin
      };
    }

    function computeContactPoint(hitShape, hurtShape) {
      if (!hitShape || !hurtShape) return null;
      const facing = hitShape.facing >= 0 ? 1 : -1;
      if (hurtShape.type === 'rect') {
        const edgeX = facing >= 0 ? hurtShape.minX : hurtShape.maxX;
        const edgeY = clamp(hitShape.center.y, hurtShape.minY, hurtShape.maxY);
        return { x: edgeX - facing * 0.02, y: edgeY };
      }
      if (hurtShape.type === 'circle') {
        const dx = hurtShape.center.x - hitShape.center.x;
        const dy = hurtShape.center.y - hitShape.center.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dirX = dx / dist;
        const dirY = dy / dist;
        return {
          x: hurtShape.center.x - dirX * hurtShape.radius,
          y: hurtShape.center.y - dirY * hurtShape.radius
        };
      }
      return {
        x: hurtShape.center?.x != null ? hurtShape.center.x - facing * 0.05 : hitShape.center.x,
        y: hurtShape.center?.y != null ? hurtShape.center.y : hitShape.center.y
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

    function resolveActorSprite(actor) {
      if (!actor) return null;
      try {
        if (typeof actor.getSprite === 'function') {
          const resolved = actor.getSprite();
          if (resolved) return resolved;
        }
      } catch { /* ignore */ }
      const meta = actor.meta || null;
      if (meta) {
        try {
          if (typeof meta.getSprite === 'function') {
            const resolved = meta.getSprite();
            if (resolved) return resolved;
          }
        } catch { /* ignore */ }
        if (meta.sprite) return meta.sprite;
        if (meta.entity?.sprite) return meta.entity.sprite;
      }
      const data = actor.data || null;
      if (data) {
        try {
          if (typeof data.getSprite === 'function') {
            const resolved = data.getSprite();
            if (resolved) return resolved;
          }
        } catch { /* ignore */ }
        if (data.sprite) return data.sprite;
        if (data.entity?.sprite) return data.entity.sprite;
      }
      return null;
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
      const flashNow = event?.now ?? performance.now();
      const sprite = resolveActorSprite(actor);
      if (sprite) SpriteFlash.trigger(sprite, flashNow);
      const lethal = actor.hp <= 0;
      if (event) event.lethal = lethal;
      if (lethal && actor.alive) {
        actor.alive = false;
        if (actor.onDeath) actor.onDeath(event);
      }
      return true;
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

          const contactPoint = computeContactPoint(hitShape, hurtShape);
          const event = {
            now,
            source: hitbox.actor,
            target: hurtbox.actor,
            hitbox,
            hurtbox,
            firstHit: hitbox.hitCount === 0,
            applyDamage: hitbox.applyDamage,
            handled: false,
            cancelled: false,
            meta: hitbox.meta || null,
            damage: 0,
            damageApplied: false,
            hitShape,
            hurtShape,
            contactPoint,
            hitFacing: hitShape?.facing ?? 1,
            phase: 'pre'
          };
          event.damage = typeof hitbox.damage === 'function' ? hitbox.damage(event) : (hitbox.damage || 0);

          if (hurtbox.actor.processHit) {
            hurtbox.actor.processHit(event);
          }
          if (hurtbox.actor.onPreHit) {
            hurtbox.actor.onPreHit(event);
          }
          if (hitbox.onHit) {
            event.phase = 'pre';
            hitbox.onHit(event);
          }
          if (event.cancelled) {
            hitbox.alreadyHit.add(hurtbox.id);
            hitbox.hitCount++;
            continue;
          }

          if (!event.handled && event.applyDamage) {
            event.damageApplied = applyDamage(hurtbox.actor, event) || event.damageApplied;
          }

          event.hitLanded = event.damageApplied || event.handled;
          if (hurtbox.actor.onPostHit) hurtbox.actor.onPostHit(event);
          if (hitbox.onHit && event.hitLanded) {
            event.phase = 'post';
            hitbox.onHit(event);
          }

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
    const shrines = [];
    const campfireMeta = { url: 'assets/sprites/Props/Campfire/CampFire.png', frames: 5, fps: 8 };
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

    let playerActor = null;
    let playerHurtbox = null;
    const playerSprite = {
      mgr: {},
      sizeByAnim: {},
      frameMeta: {},
      extentsByAnim: {},
      sprite: null,
      state: 'idle',
      sizeUnits: 2,
      baselineUnits: (FALLBACK_BASELINE_PX / PPU),
      animStarted: 0,
      animDurationMs: 0,
      loop: true
    };
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
      runHold: false,
      debugHurt: false, debugDie: false
    };

    const KeyMapDown = {
      'KeyA': 'left', 'ArrowLeft': 'left',
      'KeyD': 'right', 'ArrowRight': 'right',
      'Space': 'jump', 'KeyL': 'roll',
      'KeyJ': 'light', 'KeyK': 'heavy', 'KeyF': 'flask',
      'KeyE': 'interact',
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
      'ShiftLeft': 'runHold', 'ShiftRight': 'runHold',
      'KeyH': 'debugHurt', 'KeyX': 'debugDie'
    };

    window.addEventListener('keydown', e => {
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
      walkMax: 2.5, runMax: 4, accel: 12.0, decel: 14.0,
      jumpVel: 8, gravity: -20,
      coyoteTime: 0.12, inputBuffer: 0.12,
      rollDur: 0.35, rollSpeed: 6.0, iFrameStart: 0, iFrameEnd: 0.40, rollCost: 10,
      lightCost: 5, heavyCost: 18,
      lightDamage: 12,
      lightFinisherDamage: 16,
      heavyDamage: 30,
      heavyChargeBonusDamage: 12,
      flaskCount: 3, flaskHealPct: 0.55, flaskSip: 0.9, flaskRollCancel: 0.5, flaskLock: 0, flaskMax: 3
    };
    const state = {
      onGround: true, vy: 0, vx: 0, lastGrounded: performance.now(), jumpBufferedAt: -Infinity, lastJumpPressAt: -Infinity,
      airJumpsRemaining: 1,
      airFlipActive: false,
      airFlipUntil: 0,
      rolling: false, rollT: 0, iFramed: false,
      rollStartAt: 0,
      rollInvulnStartAt: 0,
      rollInvulnEndAt: 0,
      rollInvulnDuration: 0,
      rollInvulnApplied: false,
      rollFacing: null,
      acting: false, facing: 1, dead: false,
      flasking: false,
      flaskStart: 0,
      flaskEndAt: 0,
      flaskHealApplied: false,

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
      getSprite: () => playerSprite.sprite,
      processHit: (event) => {
        const now = performance.now();
        if (state.dead) {
          event.cancelled = true;
          event.applyDamage = false;
          return;
        }

        if (state.rolling) {
          const inIFrame = state.rollInvulnDuration > 0 && now >= state.rollInvulnStartAt && now < state.rollInvulnEndAt;
          if (inIFrame) {
            event.cancelled = true;
            event.applyDamage = false;
            event.handled = true;
            return;
          }
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

      // Light combo (ground)
      light1: { url: 'assets/sprites/player/Light1.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'light2' },
      light2: { url: 'assets/sprites/player/Light2.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'light3' },
      light3: { url: 'assets/sprites/player/Light3.png', frames: 6,  fps: 16, loop: false, cancelFrac: 0.7, next: null },

      // Air combo
      air1: { url: 'assets/sprites/player/AirAttack1.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'air2' },
      air2: { url: 'assets/sprites/player/AirAttack2.png', frames: 4,  fps: 16, loop: false, cancelFrac: 0.6, next: 'air3' },
      air3: { url: 'assets/sprites/player/AirAttack3.png', frames: 6,  fps: 16, loop: false, cancelFrac: 0.7, next: null },

      // Air movement & heavy
      jump:   { url: 'assets/sprites/player/Jump.png',   frames: 3,  fps: 16, loop: true },
      fall:   { url: 'assets/sprites/player/Fall.png',   frames: 3,  fps: 16, loop: true },
      landing: { url: 'assets/sprites/player/Landing.png', frames: 5,  fps: 16, loop: false },
      heavy:  { url: 'assets/sprites/player/Heavy.png',  frames: 6,  fps: 12, loop: false },

      // Hurt + Death
      hurt:   { url: 'assets/sprites/player/Hurt.png',   frames: 3,  fps: 14, loop: false },
      death:  { url: 'assets/sprites/player/Death.png',  frames: 14, fps: 12, loop: false },

    };

    const HEAL_FX_META = { url: 'assets/sprites/VFX/heal.png', frames: 6, fps: 6.6667 };
    const LAND_SMOKE_FX_META = { url: 'assets/sprites/VFX/Land smoke FX.png', frames: 12, fps: 16 };
    const DOUBLE_JUMP_SMOKE_FX_META = { url: 'assets/sprites/VFX/Double jump smoke FX.png', frames: 11, fps: 16 };
    const ROLL_SMOKE_FX_META = { url: 'assets/sprites/VFX/Roll smoke FX.png', frames: 13, fps: 16.6667 };
    const healFx = { mgr: null, sprite: null, sizeUnits: 0, animStart: 0, animDuration: 0, frameH: 0 };
    const HEAL_FX_FRONT_OFFSET = 0.01;
    const LAND_SMOKE_FX_SCALE = 0.4;
    const DOUBLE_JUMP_SMOKE_FX_SCALE = 0.35;
    const ROLL_SMOKE_FX_SCALE = 0.3;
    const LAND_SMOKE_FRAME_MS = 1000 / LAND_SMOKE_FX_META.fps;
    const DOUBLE_JUMP_SMOKE_FRAME_MS = 1000 / DOUBLE_JUMP_SMOKE_FX_META.fps;
    const ROLL_SMOKE_FRAME_MS = 1000 / ROLL_SMOKE_FX_META.fps;
    const healFlash = {
      sprite: null,
      manager: null,
      active: false,
      start: 0,
      end: 0,
      maxAlpha: 1.3,
      fadeIn: 150,
      fadeOut: 220,
      color: new BABYLON.Color4(0, 0, 0, 0)
    };

    const HIT_FX_META = { url: 'assets/sprites/VFX/Hit FX.png', frames: 7, frameMs: 52 };
    const HURT_FX_META = { url: 'assets/sprites/VFX/Hurt FX.png', frames: 6, frameMs: 52 };
    const HIT_FX_SCALE = 0.4;
    const HURT_FX_SCALE = 0.4;
    const FX_LAYER_OFFSET = -0.035;
    const HIT_FX_POOL_SIZE = 20;
    const HURT_FX_POOL_SIZE = 16;
    const LAND_SMOKE_FX_POOL_SIZE = 12;
    const DOUBLE_JUMP_SMOKE_FX_POOL_SIZE = 12;
    const ROLL_SMOKE_FX_POOL_SIZE = 12;

    function createFxPool({ name, meta, capacity, frameMs, zOffset }) {
      const pool = {
        name,
        meta,
        capacity,
        frameMs,
        frames: meta.frames,
        zOffset: zOffset ?? FX_LAYER_OFFSET,
        manager: null,
        ready: false,
        frameW: 0,
        frameH: 0,
        sizeUnits: 0,
        baselineUnits: 0,
        extents: null,
        totalDuration: meta.frames * frameMs,
        renderGroupId: null,
        entries: new Array(capacity),
        active: [],
        free: []
      };

      for (let i = 0; i < capacity; i++) {
        pool.entries[i] = {
          sprite: null,
          active: false,
          start: 0,
          lastFrame: -1
        };
        pool.free.push(i);
      }

      pool.init = async function initFxPool() {
        if (pool.ready) return true;
        const { ok, img, w: sheetW, h: sheetH } = await loadImage(meta.url);
        if (!ok) {
          console.warn(`[FX] Sprite sheet missing for ${name}; skipping.`);
          return false;
        }
        const frameW = Math.floor(sheetW / Math.max(1, meta.frames));
        const frameH = Math.floor(sheetH);
        pool.frameW = frameW;
        pool.frameH = frameH;
        pool.sizeUnits = frameH / PPU;
        const extents = await detectBaselinePx(img, sheetW, sheetH, meta.frames, frameW, frameH);
        pool.extents = extents;
        const baselinePx = extents?.baselinePx ?? FALLBACK_BASELINE_PX;
        pool.baselineUnits = baselinePx / PPU;
        pool.totalDuration = meta.frames * frameMs;
        pool.manager = new BABYLON.SpriteManager(name, meta.url, capacity, { width: frameW, height: frameH }, scene);
        pool.manager.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
        pool.manager.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        pool.manager.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        pool.ready = true;
        return true;
      };

      pool.obtainSlot = function obtainSlot() {
        if (pool.free.length > 0) return pool.free.pop();
        let oldestPos = -1;
        let oldestStart = Infinity;
        for (let i = 0; i < pool.active.length; i++) {
          const idx = pool.active[i];
          const entry = pool.entries[idx];
          if (!entry.active) {
            oldestPos = i;
            break;
          }
          if (entry.start < oldestStart) {
            oldestStart = entry.start;
            oldestPos = i;
          }
        }
        if (oldestPos >= 0) {
          return pool.deactivateAt(oldestPos, false);
        }
        return -1;
      };

      pool.deactivateAt = function deactivateAt(pos, pushToFree = true) {
        if (pos < 0 || pos >= pool.active.length) return -1;
        const lastIndex = pool.active.length - 1;
        const idx = pool.active[pos];
        const swap = pool.active[lastIndex];
        pool.active[pos] = swap;
        pool.active.pop();
        const entry = pool.entries[idx];
        entry.active = false;
        entry.start = 0;
        entry.lastFrame = -1;
        if (entry.sprite) {
          entry.sprite.isVisible = false;
          entry.sprite.cellIndex = 0;
          entry.sprite.stopAnimation();
        }
        if (pushToFree) pool.free.push(idx);
        return idx;
      };

      pool.spawn = function spawn(x, y, sizeUnits, facing = 1, baseZ = 0, renderGroupId = null, now = performance.now()) {
        if (!pool.ready || !pool.manager) return null;
        const idx = pool.obtainSlot();
        if (idx < 0) return null;
        const entry = pool.entries[idx];
        let sprite = entry.sprite;
        if (!sprite) {
          sprite = new BABYLON.Sprite(`${name}_${idx}`, pool.manager);
          sprite.isPickable = false;
          sprite.stopAnimation();
          sprite.isVisible = false;
          entry.sprite = sprite;
        }
        const appliedSize = Math.max(0.01, sizeUnits || pool.sizeUnits);
        sprite.size = appliedSize;
        sprite.cellIndex = 0;
        sprite.stopAnimation();
        sprite.isVisible = true;
        sprite.invertU = facing < 0;
        if (pool.name === 'fx_hit') {
          sprite.position.x = x + (facing < 0 ? -appliedSize * 0.25 : appliedSize * 0.25);
        } else {
          sprite.position.x = x;
        }
        sprite.position.y = y;
        sprite.position.z = baseZ + pool.zOffset;
        const group = renderGroupId != null ? renderGroupId : pool.renderGroupId;
        if (group != null) sprite.renderingGroupId = group;
        entry.active = true;
        entry.start = now;
        entry.lastFrame = -1;
        pool.active.push(idx);
        return sprite;
      };

      pool.update = function update(now = performance.now()) {
        if (!pool.ready) return;
        let i = 0;
        while (i < pool.active.length) {
          const idx = pool.active[i];
          const entry = pool.entries[idx];
          if (!entry.active || !entry.sprite) {
            pool.deactivateAt(i);
            continue;
          }
          const elapsed = now - entry.start;
          if (elapsed >= pool.totalDuration) {
            pool.deactivateAt(i);
            continue;
          }
          const rawFrame = Math.floor(elapsed / pool.frameMs);
          const frame = clamp(rawFrame, 0, pool.frames - 1);
          if (frame !== entry.lastFrame) {
            entry.sprite.cellIndex = frame;
            entry.lastFrame = frame;
          }
          i++;
        }
      };

      return pool;
    }

    const fxHit = createFxPool({
      name: 'fx_hit',
      meta: HIT_FX_META,
      capacity: HIT_FX_POOL_SIZE,
      frameMs: HIT_FX_META.frameMs,
      zOffset: FX_LAYER_OFFSET
    });
    const fxHurt = createFxPool({
      name: 'fx_hurt',
      meta: HURT_FX_META,
      capacity: HURT_FX_POOL_SIZE,
      frameMs: HURT_FX_META.frameMs,
      zOffset: FX_LAYER_OFFSET
    });
    const fxLandSmoke = createFxPool({
      name: 'fx_land_smoke',
      meta: LAND_SMOKE_FX_META,
      capacity: LAND_SMOKE_FX_POOL_SIZE,
      frameMs: LAND_SMOKE_FRAME_MS,
      zOffset: FX_LAYER_OFFSET
    });
    const fxDoubleJumpSmoke = createFxPool({
      name: 'fx_double_jump_smoke',
      meta: DOUBLE_JUMP_SMOKE_FX_META,
      capacity: DOUBLE_JUMP_SMOKE_FX_POOL_SIZE,
      frameMs: DOUBLE_JUMP_SMOKE_FRAME_MS,
      zOffset: FX_LAYER_OFFSET
    });
    const fxRollSmoke = createFxPool({
      name: 'fx_roll_smoke',
      meta: ROLL_SMOKE_FX_META,
      capacity: ROLL_SMOKE_FX_POOL_SIZE,
      frameMs: ROLL_SMOKE_FRAME_MS,
      zOffset: FX_LAYER_OFFSET
    });

    function getPlayerFxContext() {
      const baseSprite = playerSprite.sprite;
      const basePos = baseSprite ? baseSprite.position : placeholder.position;
      const baseZ = (basePos && typeof basePos.z === 'number') ? basePos.z : 0;
      const renderGroup = baseSprite && typeof baseSprite.renderingGroupId === 'number'
        ? baseSprite.renderingGroupId
        : null;
      return { baseSprite, basePos, baseZ, renderGroup };
    }

    function computeFxCenterYFromFoot(pool, sizeUnits, footY) {
      if (!pool) return snapToPixel(footY);
      const baseSize = pool.sizeUnits || sizeUnits || 0;
      const baselineUnits = (pool.baselineUnits || 0) * (baseSize > 0 ? (sizeUnits / baseSize) : 1);
      const centerY = footY + (sizeUnits * 0.5) - baselineUnits;
      return snapToPixel(centerY);
    }

    function computeFxOffsets(pool, sizeUnits) {
      const frameH = pool?.frameH || 0;
      const frameW = pool?.frameW || 0;
      if (frameH <= 0 || frameW <= 0 || !sizeUnits) {
        const half = (sizeUnits || 0) * 0.5;
        return { offsetLeft: -half, offsetRight: half };
      }
      const pxToUnits = sizeUnits / frameH;
      const widthUnits = frameW * pxToUnits;
      const ext = pool?.extents || {};
      const leftPx = (ext.bottomLeftPx != null) ? ext.bottomLeftPx : 0;
      const rightPx = (ext.bottomRightPx != null) ? ext.bottomRightPx : frameW - 1;
      const offsetLeft = -widthUnits * 0.5 + ((leftPx + 0.5) * pxToUnits);
      const offsetRight = -widthUnits * 0.5 + ((rightPx + 0.5) * pxToUnits);
      return { offsetLeft, offsetRight };
    }

    function computeRollFootX(basePosX, facing) {
      const ext = playerSprite.extentsByAnim.roll;
      const sizeUnits = playerSprite.sizeUnits || 0;
      if (!ext || !ext.frameH || !ext.frameW || sizeUnits <= 0) {
        const fallbackOffset = sizeUnits > 0 ? sizeUnits * 0.35 : playerSprite.sizeUnits * 0.35;
        return snapToPixel(basePosX - facing * fallbackOffset);
      }
      const pxToUnits = sizeUnits / ext.frameH;
      const widthUnits = ext.frameW * pxToUnits;
      const leftPx = (ext.bottomLeftPx != null) ? ext.bottomLeftPx : 0;
      const offsetLeft = -widthUnits * 0.5 + ((leftPx + 0.5) * pxToUnits);
      const worldOffset = offsetLeft * facing;
      return snapToPixel(basePosX + worldOffset);
    }
    
    function spawnLandSmokeFx(now = performance.now()) {
      const { basePos, baseZ, renderGroup } = getPlayerFxContext();
      if (!basePos) return;
      const facing = state.facing >= 0 ? 1 : -1;
      const sizeUnits = Math.max(0.01, playerSprite.sizeUnits * LAND_SMOKE_FX_SCALE);
      const footY = snapToPixel(basePos.y - feetCenterY());
      const spawnY = computeFxCenterYFromFoot(fxLandSmoke, sizeUnits, footY - 0.1);
      const spawnX = snapToPixel(basePos.x);
      fxLandSmoke.spawn(spawnX, spawnY, sizeUnits, facing, baseZ, renderGroup, now);
    }

    function spawnDoubleJumpSmokeFx(now = performance.now()) {
      const { basePos, baseZ, renderGroup } = getPlayerFxContext();
      if (!basePos) return;
      const facing = state.facing >= 0 ? 1 : -1;
      const sizeUnits = Math.max(0.01, playerSprite.sizeUnits * DOUBLE_JUMP_SMOKE_FX_SCALE);
      const footY = snapToPixel(basePos.y - feetCenterY());
      const spawnY = computeFxCenterYFromFoot(fxDoubleJumpSmoke, sizeUnits, footY - 0.1);
      const spawnX = snapToPixel(basePos.x);
      fxDoubleJumpSmoke.spawn(spawnX, spawnY, sizeUnits, facing, baseZ, renderGroup, now);
    }

    function spawnRollSmokeFx(now = performance.now()) {
      const { basePos, baseZ, renderGroup } = getPlayerFxContext();
      if (!basePos) return;
      const facing = state.rollFacing != null ? (state.rollFacing >= 0 ? -1 : 1) : (state.facing >= 0 ? -1 : 1);
      const sizeUnits = Math.max(0.01, playerSprite.sizeUnits * ROLL_SMOKE_FX_SCALE);
      const footY = snapToPixel(basePos.y - feetCenterY());
      const spawnY = computeFxCenterYFromFoot(fxRollSmoke, sizeUnits, footY - 0.1);
      const footX = computeRollFootX(basePos.x, facing);
      const fxOffsets = computeFxOffsets(fxRollSmoke, sizeUnits);
      const frontOffset = Number.isFinite(fxOffsets.offsetRight) ? fxOffsets.offsetRight : sizeUnits * 0.5;
      const spawnX = snapToPixel(footX + (frontOffset * facing));
      fxRollSmoke.spawn(spawnX, spawnY, sizeUnits, facing, baseZ, renderGroup, now);
    }

    function triggerDoubleJump(now = performance.now()) {
      state.vy = stats.jumpVel;
      state.onGround = false;
      state.jumpBufferedAt = 0;
      state.airJumpsRemaining = Math.max(0, (state.airJumpsRemaining || 0) - 1);
      state.landing = false;
      state.landingStartAt = 0;
      state.landingUntil = 0;
      state.landingTriggeredAt = 0;

      spawnDoubleJumpSmokeFx(now);

      const rollMeta = SHEETS.roll;
      const rollMgr = playerSprite.mgr.roll;
      if (rollMeta && rollMgr && playerSprite.sprite) {
        const durationMs = (rollMeta.frames / rollMeta.fps) * 1000;
        setAnim('roll', false);
        state.airFlipActive = durationMs > 0;
        state.airFlipUntil = state.airFlipActive ? now + durationMs : 0;
      } else {
        state.airFlipActive = false;
        state.airFlipUntil = 0;
      }
    }

    // Attack/Action timing
    const COMBO_TRANSITION_GRACE_MS = 150;
    const combo = {
      chain: null,
      nextChain: null,
      lastChain: null,
      lastChainAt: 0,
      stage: 0,
      endAt: 0,
      cancelAt: 0,
      queued: false,
      chainSwapQueued: false,
      pendingHit: false,
      hitAt: 0,
      hitMeta: null
    };
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
      lastHoldMs: 0,
      lastDamage: 0
    };
    const PLAYER_ATTACKS = {
      light1: {
        shape: 'rect',
        width: 1.05,
        height: 1.2,
        offset: { x: 0.85, y: 0 },
        damage: () => stats.lightDamage,
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
        durationMs: 120,
        hitFrac: 0.48,
        hitstopMs: HITSTOP_LIGHT_MS + 10,
        shakeMagnitude: CAMERA_SHAKE_MAG * 0.85,
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS
      },
      air1: {
        shape: 'rect',
        width: 1.05,
        height: 1.2,
        offset: { x: 0.85, y: 0 },
        damage: () => stats.lightDamage,
        durationMs: 110,
        hitFrac: 0.42,
        hitstopMs: HITSTOP_LIGHT_MS,
        shakeMagnitude: CAMERA_SHAKE_MAG * 0.72,
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS
      },
      air2: {
        shape: 'rect',
        width: 1.1,
        height: 1.2,
        offset: { x: 0.9, y: 0 },
        damage: () => stats.lightDamage,
        durationMs: 110,
        hitFrac: 0.42,
        hitstopMs: HITSTOP_LIGHT_MS,
        shakeMagnitude: CAMERA_SHAKE_MAG * 0.75,
        shakeDurationMs: CAMERA_SHAKE_DURATION_MS
      },
      air3: {
        shape: 'rect',
        width: 1.25,
        height: 1.25,
        offset: { x: 1.0, y: 0 },
        damage: () => stats.lightFinisherDamage ?? stats.lightDamage,
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
    let actionEndAt = 0; // generic end time for non-combo actions (hurt, heavy, death)

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
      playerSprite.frameMeta[metaKey] = { frameW, frameH };

      const extents = await detectBaselinePx(img, sheetW, sheetH, meta.frames, frameW, frameH);
      if (extents) {
        playerSprite.extentsByAnim[metaKey] = {
          frameW,
          frameH,
          baselinePx: extents.baselinePx,
          baselineUnits: (extents.baselinePx ?? FALLBACK_BASELINE_PX) / PPU,
          bottomOpaqueY: extents.bottomOpaqueY,
          bottomLeftPx: extents.bottomLeftPx,
          bottomRightPx: extents.bottomRightPx,
          leftPx: extents.leftPx,
          rightPx: extents.rightPx
        };
      }

      // Baseline auto-detect (idle only)
      if (computeBaseline) {
        const baselinePx = extents?.baselinePx ?? FALLBACK_BASELINE_PX;
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
      const stageId = meta.stage ?? combo.stage ?? 1;
      const chainId = meta.chain || combo.chain || (state.onGround ? 'light' : 'air');
      const fallbackId = getComboAnimKey(chainId, stageId) || `${chainId}${stageId}`;
      const inferredId = meta.attackId || fallbackId || meta.type || 'light1';
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
        pierce,
        friendlyFire,
        meta: { attackId: inferredId, stage: meta.stage, charged: meta.charged },
        onHit: (event) => {
          if (event.damageApplied) {
            const contact = event.contactPoint || event.hurtShape?.center || null;
            if (contact) {
              const baseSprite = playerSprite.sprite;
              const basePos = baseSprite ? baseSprite.position : placeholder.position;
              const baseZ = (basePos && typeof basePos.z === 'number') ? basePos.z : 0;
              const renderGroup = baseSprite && typeof baseSprite.renderingGroupId === 'number'
                ? baseSprite.renderingGroupId
                : null;
              const facing = event.hitFacing ?? (state.facing >= 0 ? 1 : -1);
              const scaleUnits = playerSprite.sizeUnits * HIT_FX_SCALE;
              const posX = contact.x ?? (event.hurtShape ? event.hurtShape.center.x : basePos.x);
              const posY = contact.y ?? (event.hurtShape ? event.hurtShape.center.y : basePos.y);
              fxHit.spawn(posX, posY, scaleUnits, facing, baseZ, renderGroup, event.now);
            }
          }
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

      // Light combo
      const l1 = await createManagerAuto('light1'); if (l1.ok) playerSprite.mgr.light1 = l1.mgr;
      const l2 = await createManagerAuto('light2'); if (l2.ok) playerSprite.mgr.light2 = l2.mgr;
      const l3 = await createManagerAuto('light3'); if (l3.ok) playerSprite.mgr.light3 = l3.mgr;

      // Air combo
      const a1 = await createManagerAuto('air1'); if (a1.ok) playerSprite.mgr.air1 = a1.mgr;
      const a2 = await createManagerAuto('air2'); if (a2.ok) playerSprite.mgr.air2 = a2.mgr;
      const a3 = await createManagerAuto('air3'); if (a3.ok) playerSprite.mgr.air3 = a3.mgr;

      // Air movement & heavy
      const j  = await createManagerAuto('jump');    if (j.ok)  playerSprite.mgr.jump    = j.mgr;
      const f  = await createManagerAuto('fall');    if (f.ok)  playerSprite.mgr.fall    = f.mgr;
      const la = await createManagerAuto('landing'); if (la.ok) playerSprite.mgr.landing = la.mgr;
      const hv = await createManagerAuto('heavy'); if (hv.ok) playerSprite.mgr.heavy = hv.mgr;

      // Hurt + Death
      const h  = await createManagerAuto('hurt');  if (h.ok)  playerSprite.mgr.hurt  = h.mgr;
      const d  = await createManagerAuto('death'); if (d.ok)  playerSprite.mgr.death = d.mgr;

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
      fxHit.init();
      fxHurt.init();
      fxLandSmoke.init();
      fxDoubleJumpSmoke.init();
      fxRollSmoke.init();
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
        SpriteFlash.setBaseColor(e.sprite, new BABYLON.Color4(1, 1, 1, alpha), now);
      }
      const WOLF_CLOSE_BAND = 2;
      const WOLF_LEAP_WEIGHT = 0.4;
      const WOLF_LEAP_COOLDOWN_RANGE_MS = { min: 1600, max: 2000 };
      const WOLF_LEAP_POST_ATTACK_GRACE_MS = 120;
      const WOLF_RUN_IN_DURATION_MS = { min: 600, max: 900 };
      const WOLF_RUN_IN_PROMOTE_MS = { min: 250, max: 400 };
      const WOLF_RUN_IN_SPEED = 3.6;
      const WOLF_BASE_STALK_SPEED_FAR = 3.1;
      const WOLF_BASE_STALK_SPEED_NEAR = 2.7;
      const WOLF_AIR_STEER = 18;

      function wolfRandRange(min, max) {
        if (!Number.isFinite(min) || !Number.isFinite(max)) return min || max || 0;
        if (max <= min) return min;
        return min + Math.random() * (max - min);
      }

      function wolfApplyJitter(base, pct = 0.12) {
        if (!Number.isFinite(base) || base === 0 || !Number.isFinite(pct) || pct <= 0) return base;
        const span = base * pct;
        return base + (Math.random() * 2 - 1) * span;
      }

      function wolfSelectMeleeAttack() {
        return Math.random() < 0.75 ? 'bite' : 'claw';
      }

      const WOLF_ATTACK_DATA = {
        bite: {
          anim: 'bite',
          hitFrac: 0.6,
          durationMs: 190,
          damage: 12,
          width: e => e.sizeUnits * 0.54,
          height: e => e.sizeUnits * 0.36,
          offset: e => ({ x: e.sizeUnits * 0.28, y: -e.sizeUnits * 0.22 }),
          maxRange: 1.05,
          comboGapMs: 150,
          recoveryMs: 380,
          cooldownMs: 820,
          windupMs: 150,
          windupJitter: 0.15,
          recoveryJitter: 0.12
        },
        claw: {
          anim: 'claw',
          hitFrac: 0.62,
          durationMs: 200,
          damage: 15,
          width: e => e.sizeUnits * 0.6,
          height: e => e.sizeUnits * 0.4,
          offset: e => ({ x: e.sizeUnits * 0.34, y: -e.sizeUnits * 0.18 }),
          maxRange: 1.25,
          comboGapMs: 170,
          recoveryMs: 440,
          cooldownMs: 880,
          windupMs: 160,
          windupJitter: 0.15,
          recoveryJitter: 0.12
        },
        leap: {
          type: 'maneuver',
          jumpVel: 7.2,
          maxDurationMs: 900,
          minAirTime: 0.32,
          recoveryMs: 220,
          cooldownMs: 1800,
          cooldownJitter: 0.12,
          windupMs: 140,
          windupJitter: 0.12,
          recoveryJitter: 0.15,
          maxAirSpeed: 6.2,
          airSteer: 22
        }
      };

      const BAT_ATTACK_DATA = {
        contact: {
          anim: 'attack',
          hitFrac: 0.45,
          durationMs: 160,
          damage: 9,
          shape: 'circle',
          radius: e => e.sizeUnits * 0.18,
          offset: e => ({ x: e.sizeUnits * 0.24, y: -e.sizeUnits * 0.12 }),
          cooldownMs: 900
        }
      };

      const BAT_AGGRO_RADIUS = 6;
      const BAT_AGGRO_HYSTERESIS = 1;
      const BAT_LEASH_RADIUS = 11;
      const BAT_VIEW_MARGIN = 0.5;
      const BAT_ATTACK_ACTIVE_FRAMES = { start: 3, end: 7 };
      const BAT_ATTACK_COOLDOWN_MS = 900;
      const BAT_FOLLOW_SPEED = 3.2;
      const BAT_FOLLOW_ACCEL = 9;
      const BAT_RETURN_SPEED = 1.6;
      const BAT_RETURN_ACCEL = 6;
      const BAT_VERTICAL_MAX_SPEED = 3.0;
      const BAT_VERTICAL_LERP = 0.03;
      const BAT_HOVER_RETURN_SPEED = 0.8;
      const BAT_HOVER_RETURN_EPSILON = 0.02;
      const BAT_REBOUND_MAX_ABOVE_HOVER = 0.6;
      const BAT_STOOP_IN_RATE = 3.6;
      const BAT_STOOP_OUT_RATE = 1.5;
      const BAT_TORSO_ALIGN_FRAC = 0.12;
      const BAT_TORSO_ALIGN_MIN = 0.06;
      const BAT_ATTACK_ALIGN_X_FRAC = 0.3;
      const BAT_ATTACK_ALIGN_MIN = 0.18;

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

      function wolfQueueMelee(e, name, now = performance.now()) {
        const def = WOLF_ATTACK_DATA[name];
        if (!def) return false;
        if (e.state === 'attack' || e.state === 'leap') return false;
        e.attackQueue = [name];
        e.comboIndex = 0;
        e.runInState = null;
        e.pendingCombo = null;
        e.readyState = null;
        const launched = startWolfAttack(e, name);
        if (launched === 'defer') return false;
        return !!launched;
      }

      function wolfQueueLeap(e, now = performance.now(), distance = Infinity) {
        const def = WOLF_ATTACK_DATA.leap;
        if (!def) return false;
        if (distance < WOLF_CLOSE_BAND) return false;
        if (now < (e.leapCooldownUntil || 0)) return false;
        if (now < (e.leapGraceUntil || 0)) return false;
        if (e.state === 'attack' || e.state === 'leap') return false;
        e.attackQueue = ['leap'];
        e.comboIndex = 0;
        e.runInState = null;
        e.pendingCombo = null;
        e.readyState = null;
        const launched = startWolfAttack(e, 'leap');
        if (launched === 'defer') return false;
        return !!launched;
      }

      function wolfStartRunIn(e, dx, now = performance.now()) {
        const dir = dx >= 0 ? 1 : -1;
        const duration = wolfRandRange(WOLF_RUN_IN_DURATION_MS.min, WOLF_RUN_IN_DURATION_MS.max);
        const promoteDelay = wolfRandRange(WOLF_RUN_IN_PROMOTE_MS.min, WOLF_RUN_IN_PROMOTE_MS.max);
        e.state = 'runIn';
        e.runInState = {
          start: now,
          endAt: now + duration,
          promoteDelay,
          lastAdvanceAt: now,
          lastAdvanceX: e.x,
          dir
        };
        e.attackQueue = [];
        e.comboIndex = 0;
        e.pendingCombo = null;
        e.readyState = null;
        e.nextComboAt = now + duration;
        e.facing = dir;
        e.vx = dir * WOLF_RUN_IN_SPEED;
        e.vy = 0;
        if (e.anim !== 'run' && e.mgr.run) setEnemyAnim(e, 'run');
      }

      function wolfIsHeroInCloseRange(e, tolerance = 0) {
        if (!e) return false;
        if (!e.playerSeen && e.state === 'patrol') return false;
        const playerPos = playerSprite.sprite?.position;
        const playerX = playerPos?.x;
        if (playerX == null) return false;
        return Math.abs(playerX - e.x) <= (WOLF_CLOSE_BAND + tolerance);
      }

      function startWolfReady(e, delayMs = 0, now = performance.now()) {
        if (!wolfIsHeroInCloseRange(e)) {
          e.readyState = null;
          return false;
        }
        const holdMs = Math.max(0, delayMs || 0);
        const holdUntil = now + holdMs;
        e.state = 'ready';
        e.stateUntil = holdUntil;
        e.readyState = {
          start: now,
          holdUntil
        };
        e.runInState = null;
        e.vx = 0;
        e.vy = 0;
        if (e.mgr.ready) setEnemyAnim(e, 'ready');
        else if (e.mgr.run) setEnemyAnim(e, 'run');
        return true;
      }

      function spawnWolfHitbox(e, def) {
        if (!e.combat || !def || e.dying) return;
        const width = typeof def.width === 'function' ? def.width(e) : def.width;
        const height = typeof def.height === 'function' ? def.height(e) : def.height;
        const offset = typeof def.offset === 'function' ? def.offset(e) : def.offset || { x: 0, y: 0 };
        const config = {
          shape: 'rect',
          width: width ?? 0,
          height: height ?? 0,
          offset,
          durationMs: def.durationMs ?? 130,
          damage: typeof def.damage === 'function' ? def.damage(e) : def.damage ?? 0,
          getOrigin: () => ({ x: e.x, y: e.y }),
          getFacing: () => e.facing,
          meta: { enemy: 'wolf', attack: e.currentAttack?.name || 'unknown' }
        };
        const attackName = e.currentAttack?.name || '';
        if (attackName !== 'leap' && playerActor) {
          config.onHit = (event) => {
            if (event.phase !== 'pre') return;
            if (event.target !== playerActor) return;
            if (state.onGround) return;
            event.cancelled = true;
            event.applyDamage = false;
          };
        }
        Combat.spawnHitbox(e.combat, config);
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
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            e.nextComboAt = Math.max(e.nextComboAt, now + 180);
            e.pendingCombo = null;
            return 'defer';
          }
        }
        const attack = { name, def, start: now, spawned: false };
        e.currentAttack = attack;
        e.pendingCombo = null;
        e.readyState = null;
        if (def.type === 'maneuver') {
          e.state = 'leap';
          const playerPos = playerSprite.sprite?.position;
          const targetX = playerPos?.x ?? (e.x + e.facing * 2);
          const gravity = e.gravity ?? -20;
          const jumpVel = def.jumpVel ?? 7;
          const gravityMag = Math.max(1, Math.abs(gravity));
          let flightTime = (2 * jumpVel) / gravityMag;
          if (def.minAirTime != null) {
            flightTime = Math.max(flightTime, def.minAirTime);
          }
          const maxAirSpeed = def.maxAirSpeed ?? WOLF_RUN_IN_SPEED;
          const desiredVx = clamp((targetX - e.x) / flightTime, -maxAirSpeed, maxAirSpeed);
          const cooldownBase = def.cooldownMs ?? wolfRandRange(WOLF_LEAP_COOLDOWN_RANGE_MS.min, WOLF_LEAP_COOLDOWN_RANGE_MS.max);
          const cooldown = Math.max(WOLF_LEAP_POST_ATTACK_GRACE_MS, wolfApplyJitter(cooldownBase, def.cooldownJitter ?? 0.15));
          e.leapState = {
            def,
            start: now,
            endBy: now + (def.maxDurationMs ?? Math.round(flightTime * 1000)),
            airborneAt: now,
            landedAt: 0,
            targetX,
            flightTime,
            initialVx: desiredVx,
            initialVy: jumpVel
          };
          e.vx = desiredVx;
          e.vy = jumpVel;
          e.onGround = false;
          e.leapCooldownUntil = now + cooldown;
          e.runInState = null;
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
        e.readyState = null;
        const holdReady = !!(attackDef && attackDef.type !== 'maneuver' && wolfIsHeroInCloseRange(e));
        if (e.attackQueue && e.comboIndex < e.attackQueue.length - 1) {
          e.comboIndex += 1;
          const nextName = e.attackQueue[e.comboIndex];
          const gapBase = attackDef ? (attackDef.comboGapMs ?? attackDef.landBufferMs ?? 150) : 150;
          const gap = Math.max(80, wolfApplyJitter(gapBase, attackDef?.comboGapJitter ?? 0.12));
          const gapUntil = now + gap;
          e.stateUntil = gapUntil;
          e.pendingCombo = { name: nextName, at: gapUntil };
          e.nextComboAt = Math.max(e.nextComboAt, gapUntil);
          if (!(holdReady && startWolfReady(e, gap, now))) {
            e.pendingCombo = null;
            e.attackQueue = [];
            e.comboIndex = 0;
            e.state = 'stalk';
            if (e.mgr.run) setEnemyAnim(e, 'run');
          }
        } else {
          e.attackQueue = [];
          e.comboIndex = 0;
          e.pendingCombo = null;
          const recoveryBase = attackDef ? (attackDef.recoveryMs ?? attackDef.landBufferMs ?? 380) : 380;
          const cooldownBase = attackDef ? (attackDef.cooldownMs ?? 760) : 760;
          const recovery = Math.max(140, wolfApplyJitter(recoveryBase, attackDef?.recoveryJitter ?? 0.12));
          const cooldown = Math.max(recovery, wolfApplyJitter(cooldownBase, attackDef?.cooldownJitter ?? 0.12));
          e.stateUntil = now + recovery;
          e.nextComboAt = now + cooldown;
          e.leapGraceUntil = now + WOLF_LEAP_POST_ATTACK_GRACE_MS;
          if (!(holdReady && startWolfReady(e, recovery, now))) {
            e.state = e.playerSeen ? 'stalk' : 'patrol';
            if (e.state === 'stalk' && e.mgr.run) setEnemyAnim(e, 'run');
          }
        }
      }

      function spawnBatHitbox(e, def, overrides = {}) {
        if (!e.combat || !def || e.dying) return null;
        const shape = overrides.shape || def.shape || 'rect';
        const width = overrides.width ?? (typeof def.width === 'function' ? def.width(e) : def.width);
        const height = overrides.height ?? (typeof def.height === 'function' ? def.height(e) : def.height);
        const radius = overrides.radius ?? (typeof def.radius === 'function' ? def.radius(e) : def.radius);
        const offsetDefault = typeof def.offset === 'function' ? def.offset(e) : def.offset || { x: 0, y: 0 };
        const offset = overrides.offset ?? offsetDefault;
        const duration = overrides.durationMs ?? def.durationMs ?? 120;
        const getOrigin = overrides.getOrigin || (() => ({ x: e.x, y: e.y }));
        const onHit = overrides.onHit || null;
        const onExpire = overrides.onExpire || null;
        const config = {
          shape,
          offset,
          durationMs: duration,
          damage: typeof def.damage === 'function' ? def.damage(e) : def.damage ?? 0,
          getOrigin,
          getFacing: () => e.facing,
          meta: { enemy: 'bat', attack: 'contact' },
          onHit,
          onExpire
        };
        if (shape === 'circle') {
          config.radius = Math.max(0, radius ?? 0);
        } else {
          config.width = width ?? 0;
          config.height = height ?? 0;
        }
        if (overrides.absolute || def.absolute) {
          config.absolute = true;
        }
        const hitbox = Combat.spawnHitbox(e.combat, config);
        return hitbox;
      }

      function computeBatAttackCircle(e, def = BAT_ATTACK_DATA.contact) {
        if (!e || !def) return null;
        const shape = def.shape || 'rect';
        if (shape !== 'circle') return null;
        const offsetBase = typeof def.offset === 'function' ? def.offset(e) : def.offset || { x: 0, y: 0 };
        const offset = { x: offsetBase.x ?? 0, y: offsetBase.y ?? 0 };
        const radiusBase = typeof def.radius === 'function' ? def.radius(e) : def.radius;
        const radius = Math.max(0, radiusBase ?? 0);
        return {
          type: 'circle',
          center: { x: e.x + offset.x * (def.absolute ? 1 : e.facing), y: e.y + offset.y },
          radius
        };
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
          const extents = await detectBaselinePx(img, sheetW, sheetH, frames, frameW, frameH);
          const baselinePx = extents?.baselinePx ?? FALLBACK_BASELINE_PX;
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
        const prevSprite = e.sprite || null;
        const wasFlashing = prevSprite ? SpriteFlash.isFlashing(prevSprite) : false;
        const flashCarryNow = wasFlashing ? performance.now() : 0;
        const pos = prevSprite ? prevSprite.position.clone() : new BABYLON.Vector3(e.x, e.y, 0);
        let footY = null;
        if (!preserveAnchor) {
          const prevBaseline = e.baselineUnits;
          const prevCenterY = pos.y;
          footY = prevBaseline != null ? (prevCenterY - (e.sizeUnits * 0.5) + prevBaseline) : null;
        }
        if (prevSprite) prevSprite.dispose();
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
        if (wasFlashing) {
          const triggerAt = flashCarryNow || performance.now();
          SpriteFlash.trigger(sp, triggerAt);
        }
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
          hpMax: 38, hp: 38,
          state: 'patrol', playerSeen: false, packRole: 'support',
          attackQueue: [], comboIndex: 0, currentAttack: null,
          attackHitAt: 0, attackEndAt: 0, stateUntil: 0,
          nextComboAt: 0, leapState: null, hitReactUntil: 0,
          pendingLandingState: null,
          runInState: null,
          leapCooldownUntil: 0,
          leapGraceUntil: 0,
          pendingCombo: null,
          readyState: null,
          dying: false, deathAt: 0, fadeStartAt: 0, fadeDone: false,
          fadeDelayMs: ENEMY_FADE_DELAY_MS, fadeDurationMs: ENEMY_FADE_DURATION_MS,
          dead: false, combat: null, hurtbox: null
        };
        await loadEnemySheet(e, 'run', 'assets/sprites/Mobs/wolf/Run.png', 14, true, true);
        await loadEnemySheet(e, 'ready', 'assets/sprites/Mobs/wolf/Ready.png', 12, true, true);
        await loadEnemySheet(e, 'bite', 'assets/sprites/Mobs/wolf/Bite.png', 12, false, true);
        await loadEnemySheet(e, 'claw', 'assets/sprites/Mobs/wolf/Claw.png', 12, false, true);
        await loadEnemySheet(e, 'hit', 'assets/sprites/Mobs/wolf/Hit.png', 12, false, true);
        await loadEnemySheet(e, 'dead', 'assets/sprites/Mobs/wolf/Dead.png', 12, false, true);
        await loadEnemySheet(e, 'jumpUp', 'assets/sprites/Mobs/wolf/JumpUp.png', 14, false);
        await loadEnemySheet(e, 'jumpMid', 'assets/sprites/Mobs/wolf/JumpMid.png', 14, false);
        await loadEnemySheet(e, 'jumpDown', 'assets/sprites/Mobs/wolf/JumpDown.png', 14, false);
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
          meta: { entity: e, type: e.type },
          getPosition: () => ({ x: e.x, y: e.y }),
          getFacing: () => e.facing,
          getSprite: () => e.sprite,
          onHealthChange: (hp) => { e.hp = hp; },
          onDamage: (event) => {
            const now = performance.now();
            e.lastHitAt = now;
            if (e.dying || e.dead) return;
            e.attackQueue = [];
            e.comboIndex = 0;
            e.currentAttack = null;
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            e.pendingCombo = null;
            e.readyState = null;
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
          onDeath: () => {
            if (e.dead || e.dying) return;
            const now = performance.now();
            e.dying = true;
            e.deathAt = now;
            e.fadeStartAt = now + (e.fadeDelayMs ?? ENEMY_FADE_DELAY_MS);
            e.attackQueue = [];
            e.comboIndex = 0;
            e.currentAttack = null;
            e.attackHitAt = 0;
            e.attackEndAt = 0;
            e.pendingCombo = null;
            e.readyState = null;
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
          hpMax: 22, hp: 22,
          nextAttackAt: 0, attackHitAt: 0, attackEndAt: 0,
          attackHitbox: null, attackDidDamage: false, attackStartedAt: 0,
          homeX: x, hitReactUntil: 0,
          awakened: false,
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
          pendingAnimName: '', pendingAnimOpts: null, pendingAnimForce: false,
          stoopProgress: 0,
          hoverReturnActive: false
        };
        await loadEnemySheet(e, 'sleep', 'assets/sprites/Mobs/bat/Sleep.png', 1, true, true);
        await loadEnemySheet(e, 'wake', 'assets/sprites/Mobs/bat/WakeUp.png', 12, false, true);
        await loadEnemySheet(e, 'fly', 'assets/sprites/Mobs/bat/Flying.png', 12, true, true);
        await loadEnemySheet(e, 'attack', 'assets/sprites/Mobs/bat/Attack.png', 12, false, true);
        await loadEnemySheet(e, 'hit', 'assets/sprites/Mobs/bat/Hit.png', 12, false, true);
        await loadEnemySheet(e, 'dead', 'assets/sprites/Mobs/bat/Dead.png', 12, false, true);
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
          meta: { entity: e, type: e.type },
          getPosition: () => ({ x: e.x, y: e.y }),
          getFacing: () => e.facing,
          getSprite: () => e.sprite,
          onHealthChange: (hp) => { e.hp = hp; },
          onDamage: (event) => {
            const now = performance.now();
            e.lastHitAt = now;
            if (e.dying || e.dead) return;
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
            const speed = absDx > 4 ? WOLF_BASE_STALK_SPEED_FAR : WOLF_BASE_STALK_SPEED_NEAR;
            if (Math.abs(diff) > 0.1) {
              e.vx = Math.sign(diff) * speed;
            } else {
              e.vx = 0;
            }
            e.facing = dx >= 0 ? 1 : -1;
            const inClose = absDx < WOLF_CLOSE_BAND;
            const canAct = !e.pendingLandingState && e.attackQueue.length === 0 && now >= e.nextComboAt;
            if (canAct && e.onGround) {
              if (inClose) {
                const attack = wolfSelectMeleeAttack();
                wolfQueueMelee(e, attack, now);
              } else {
                const leapReady = now >= e.leapCooldownUntil && now >= e.leapGraceUntil;
                const doLeap = leapReady && Math.random() < WOLF_LEAP_WEIGHT;
                if (doLeap && wolfQueueLeap(e, now, absDx)) {
                  // queued leap
                } else {
                  wolfStartRunIn(e, dx, now);
                }
              }
            }
            break;
          }
          case 'runIn': {
            if (dying) { e.vx *= 0.9; break; }
            const run = e.runInState;
            if (!run) { e.state = 'stalk'; break; }
            const dir = dx >= 0 ? 1 : -1;
            e.facing = dir;
            e.vx = dir * WOLF_RUN_IN_SPEED;
            e.vy = 0;
            if (Math.abs(e.x - run.lastAdvanceX) > 0.03) {
              run.lastAdvanceX = e.x;
              run.lastAdvanceAt = now;
            }
            const inClose = absDx < WOLF_CLOSE_BAND;
            if (!e.onGround) {
              break;
            }
            if (inClose) {
              e.runInState = null;
              const attack = wolfSelectMeleeAttack();
              wolfQueueMelee(e, attack, now);
              break;
            }
            if (now - run.lastAdvanceAt >= run.promoteDelay) {
              if (now >= e.leapCooldownUntil && now >= e.leapGraceUntil) {
                e.runInState = null;
                if (wolfQueueLeap(e, now, absDx)) {
                  break;
                }
                // fallback to extended run-in if leap denied
                run.lastAdvanceAt = now;
                e.state = 'stalk';
                e.nextComboAt = now + 120;
                break;
              } else {
                run.lastAdvanceAt = now;
              }
            }
            if (now >= run.endAt) {
              e.runInState = null;
              e.state = 'stalk';
              e.nextComboAt = now + 160;
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
              if (!e.onGround) {
                const steer = leap.def?.airSteer ?? WOLF_AIR_STEER;
                const maxSpeed = leap.def?.maxAirSpeed ?? WOLF_RUN_IN_SPEED;
                const elapsed = Math.max(0, (now - leap.start) / 1000);
                const total = Math.max(elapsed + 0.001, leap.flightTime ?? elapsed + 0.001);
                const remaining = Math.max(0.08, total - elapsed);
                const desiredVx = clamp((leap.targetX - e.x) / remaining, -maxSpeed, maxSpeed);
                const diff = desiredVx - e.vx;
                const maxStep = steer * dt;
                if (maxStep > 0) {
                  const adj = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
                  e.vx += adj;
                }
              }
              if (!dying && !e.pendingLandingState && now >= leap.endBy) {
                finishWolfAttack(e, { def: leap.def });
              } else if ((dying || e.pendingLandingState) && now >= leap.endBy) {
                e.leapState = null;
              }
            }
            break;
          }
          case 'recover':
          case 'ready': {
            if (e.state === 'recover') {
              e.state = 'ready';
            }
            if (!e.readyState) {
              e.readyState = { start: now, holdUntil: e.stateUntil || now };
            }
            if (dying) {
              e.vx *= 0.85;
              break;
            }
            const close = wolfIsHeroInCloseRange(e);
            if (!close || e.pendingLandingState) {
              if (!e.pendingLandingState) {
                e.pendingCombo = null;
                e.state = e.playerSeen ? 'stalk' : 'patrol';
                if (e.state === 'stalk' && e.mgr.run) setEnemyAnim(e, 'run');
              }
              e.readyState = null;
              break;
            }
            e.vx += (0 - e.vx) * Math.min(1, 14 * dt);
            e.vy = 0;
            e.facing = dx >= 0 ? 1 : -1;
            if (e.mgr.ready) setEnemyAnim(e, 'ready');
            const pendingCombo = e.pendingCombo;
            if (!e.pendingLandingState && pendingCombo && now >= pendingCombo.at) {
              if (!e.onGround) {
                break;
              }
              e.pendingCombo = null;
              if (pendingCombo.name === 'leap' && Math.abs(dx) < WOLF_CLOSE_BAND) {
                const fallback = wolfSelectMeleeAttack();
                if (wolfQueueMelee(e, fallback, now)) {
                  e.readyState = null;
                  break;
                }
                e.state = 'stalk';
                e.readyState = null;
                if (e.mgr.run) setEnemyAnim(e, 'run');
                break;
              }
              const launch = startWolfAttack(e, pendingCombo.name);
              if (launch && launch !== 'defer') {
                e.readyState = null;
                break;
              }
              if (launch === 'defer') {
                e.readyState = null;
                if (e.state === 'stalk' && e.mgr.run) setEnemyAnim(e, 'run');
                break;
              }
              e.state = 'stalk';
              e.readyState = null;
              if (e.mgr.run) setEnemyAnim(e, 'run');
              break;
            }
            const holdUntil = Math.max(e.readyState?.holdUntil ?? 0, e.stateUntil ?? 0);
            const canAct = now >= holdUntil && now >= e.nextComboAt && e.attackQueue.length === 0;
            if (canAct && e.onGround) {
              const attack = wolfSelectMeleeAttack();
              if (wolfQueueMelee(e, attack, now)) {
                e.readyState = null;
                break;
              }
              if (e.state === 'stalk') {
                e.readyState = null;
                if (e.mgr.run) setEnemyAnim(e, 'run');
                break;
              }
            }
            break;
          }
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
        if (!dying && e.state === 'ready' && e.comboIndex === 0 && e.attackQueue.length === 0 && e.onGround && now >= e.stateUntil) {
          if (!wolfIsHeroInCloseRange(e)) {
            e.readyState = null;
            e.state = e.playerSeen ? 'stalk' : 'patrol';
            if (e.state === 'stalk' && e.mgr.run) setEnemyAnim(e, 'run');
          }
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
        return state === 'fly' || state === 'attack' || state === 'hit';
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
        const playerHurtShape = computeHurtboxShape(playerHurtbox);
        const heroTorsoY = heroFeetY + heroSize * HERO_TORSO_FRAC;
        const fallbackDim = heroSize > 0 ? heroSize * 0.5 : e.sizeUnits * 0.5;
        const heroHurtHeight = playerHurtShape?.height ?? fallbackDim;
        const heroHurtWidth = playerHurtShape?.width ?? fallbackDim;
        const torsoBandHalf = Math.max(BAT_TORSO_ALIGN_MIN, heroHurtHeight * BAT_TORSO_ALIGN_FRAC);
        const horizontalAlignWindow = Math.max(BAT_ATTACK_ALIGN_MIN, heroHurtWidth * BAT_ATTACK_ALIGN_X_FRAC);
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
          if (!e.aggro) {
            e.hoverReturnActive = false;
          }
          e.aggro = true;
          e.awakened = true;
        }
        const leashBreak = heroFromSpawn > BAT_LEASH_RADIUS;
        if (e.aggro && (detectionDist > releaseDist || !playerInView || leashBreak)) {
          e.aggro = false;
          e.hoverReturnActive = true;
          e.bob = 0;
          e.nextAttackAt = Math.max(e.nextAttackAt, now + BAT_ATTACK_COOLDOWN_MS);
          if (e.attackHitbox) {
            e.attackHitbox.markRemove = true;
            e.attackHitbox = null;
          }
        }

        if (e.aggro) {
          e.stoopProgress = Math.min(1, (e.stoopProgress ?? 0) + dt * BAT_STOOP_IN_RATE);
        } else {
          e.stoopProgress = Math.max(0, (e.stoopProgress ?? 0) - dt * BAT_STOOP_OUT_RATE);
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
            const returningToHover = !e.aggro && e.hoverReturnActive;
            if (!e.aggro && !returningToHover) {
              e.bob += dt * 2.2;
            }
            const baseClampMin = e.patrolMin ?? (e.homeX - 3);
            const baseClampMax = e.patrolMax ?? (e.homeX + 3);
            const leashClampMin = e.spawnAnchor.x - (BAT_LEASH_RADIUS - 0.25);
            const leashClampMax = e.spawnAnchor.x + (BAT_LEASH_RADIUS - 0.25);
            const clampMin = e.aggro ? leashClampMin : baseClampMin;
            const clampMax = e.aggro ? leashClampMax : baseClampMax;
            const minCenter = centerFromFoot(e, -0.1);
            const maxCenter = centerFromFoot(e, e.hover + BAT_REBOUND_MAX_ABOVE_HOVER);
            const baseHoverCenter = Math.max(minCenter, Math.min(maxCenter, centerFromFoot(e, e.hover)));
            const bobValue = (!e.aggro && !returningToHover) ? Math.sin(e.bob) * 0.35 : 0;
            const stoopAmount = e.stoopProgress ?? 0;
            const targetX = e.aggro
              ? Math.max(clampMin, Math.min(clampMax, playerX))
              : Math.max(clampMin, Math.min(clampMax, e.spawnAnchor.x));
            const idleCenter = Math.max(minCenter, Math.min(maxCenter, centerFromFoot(e, e.hover + bobValue)));
            const pursuitCenter = Math.max(minCenter, Math.min(maxCenter, heroTorsoY));
            const desiredCenter = e.aggro
              ? idleCenter + (pursuitCenter - idleCenter) * stoopAmount
              : (returningToHover ? baseHoverCenter : idleCenter);
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
            } else if (returningToHover) {
              const dy = desiredCenter - e.y;
              const maxStep = BAT_HOVER_RETURN_SPEED * dt;
              const step = Math.sign(dy) * Math.min(Math.abs(dy), maxStep);
              e.y += step;
              const remaining = desiredCenter - e.y;
              if (Math.abs(remaining) <= BAT_HOVER_RETURN_EPSILON) {
                e.y = desiredCenter;
                e.hoverReturnActive = false;
                e.bob = 0;
              }
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
            const dxNow = playerX - e.x;
            if (Math.abs(e.vx) > 0.02) {
              e.facing = e.vx >= 0 ? 1 : -1;
            } else if (e.aggro && Math.abs(dxNow) > 0.02) {
              e.facing = dxNow >= 0 ? 1 : -1;
            }
            const attackCircle = computeBatAttackCircle(e);
            const torsoAligned = Math.abs(e.y - heroTorsoY) <= torsoBandHalf;
            const horizontalAligned = Math.abs(dxNow) <= horizontalAlignWindow;
            const contactReady = attackCircle && playerHurtShape && hurtShapesOverlap(attackCircle, playerHurtShape);
            const stoopReady = torsoAligned || (stoopAmount >= 0.95 && Math.abs(e.y - heroTorsoY) <= torsoBandHalf * 1.5);
            const canAttack = e.aggro && now >= e.nextAttackAt && stoopReady && horizontalAligned && contactReady;
            if (canAttack) {
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
            const minCenter = centerFromFoot(e, -0.1);
            const maxCenter = centerFromFoot(e, e.hover + BAT_REBOUND_MAX_ABOVE_HOVER);
            const prevY = e.y;
            if (e.aggro) {
              const pursuitCenter = Math.max(minCenter, Math.min(maxCenter, heroTorsoY));
              const dy = pursuitCenter - e.y;
              const framesEquivalent = Math.max(0, dt * 60);
              const lerpFactor = Math.max(0, Math.min(1, 1 - Math.pow(1 - BAT_VERTICAL_LERP, framesEquivalent)));
              const desiredStep = dy * lerpFactor;
              const maxStep = BAT_VERTICAL_MAX_SPEED * dt;
              const step = Math.sign(desiredStep) * Math.min(Math.abs(desiredStep), maxStep);
              e.y += step;
            }
            if (e.y < minCenter) {
              e.y = minCenter;
            } else if (e.y > maxCenter) {
              e.y = maxCenter;
            }
            if (dt > 0) {
              e.vy = (e.y - prevY) / dt;
            } else {
              e.vy = 0;
            }
            const dxNow = playerX - e.x;
            if (Math.abs(dxNow) > 0.02) {
              e.facing = dxNow >= 0 ? 1 : -1;
            }
            const attackCircle = computeBatAttackCircle(e, attackDef);
            const torsoAligned = Math.abs(e.y - heroTorsoY) <= torsoBandHalf;
            const horizontalAligned = Math.abs(dxNow) <= horizontalAlignWindow;
            const contactReady = attackCircle && playerHurtShape && hurtShapesOverlap(attackCircle, playerHurtShape);
            const attackReadyNow = torsoAligned && horizontalAligned && contactReady;
            if (inActiveWindow && !e.attackHitbox && !e.attackDidDamage && attackReadyNow) {
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
            } else if (e.attackHitbox && (!inActiveWindow || e.attackDidDamage || !attackReadyNow)) {
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
              const hpLine = `HP:${Math.max(0, Math.round(e.hp ?? 0)).toString().padStart(3)}`;
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
    function tryFlask() {
      if (state.dead || stats.flaskCount <= 0 || state.rolling) return;
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

    function terminateRollState({ resetVelocity = true } = {}) {
      const hadInvulnerability = state.rollInvulnApplied || state.iFramed;
      if (typeof state.rollFacing === 'number') {
        state.facing = state.rollFacing;
      }
      state.rollFacing = null;
      state.rolling = false;
      state.rollT = 0;
      state.iFramed = false;
      state.rollStartAt = 0;
      state.rollInvulnStartAt = 0;
      state.rollInvulnEndAt = 0;
      state.rollInvulnDuration = 0;
      state.rollInvulnApplied = false;
      if (resetVelocity) {
        state.vx = 0;
        state.vy = 0;
      }
      if (hadInvulnerability && playerActor) {
        Combat.setInvulnerable(playerActor, 'roll', false);
      }
    }

    function startRoll() {
      if (state.dead || state.rolling) return;
      if (!state.onGround) return;
      const flasking = state.flasking;
      if (state.acting && !flasking) return;
      if (stats.stam < stats.rollCost) return;
      if (flasking) {
        if (!state.flaskHealApplied) return;
        cleanupFlaskState();
      }
      setST(stats.stam - stats.rollCost);
      const now = performance.now();
      const startOffset = Math.max(0, stats.iFrameStart || 0);
      const rollDurationOffset = Math.max(startOffset, stats.rollDur || 0);
      const configuredEndOffset = Math.max(startOffset, stats.iFrameEnd || 0);
      const endOffset = Math.max(rollDurationOffset, configuredEndOffset);
      const iStart = now + startOffset * 1000;
      const iEnd = now + endOffset * 1000;
      state.rollFacing = state.facing >= 0 ? 1 : -1;
      state.rolling = true;
      state.rollT = 0;
      state.iFramed = false;
      state.rollStartAt = now;
      state.rollInvulnStartAt = iStart;
      state.rollInvulnEndAt = iEnd;
      state.rollInvulnDuration = Math.max(0, iEnd - iStart);
      state.rollInvulnApplied = false;
      Combat.setInvulnerable(playerActor, 'roll', false);
      setAnim('roll', true);
      spawnRollSmokeFx(now);
    }

    // Combo handling (ground & air)
    function getComboAnimKey(chain, stage) {
      if (chain === 'light') {
        return stage === 1 ? 'light1' : stage === 2 ? 'light2' : 'light3';
      }
      if (chain === 'air') {
        return stage === 1 ? 'air1' : stage === 2 ? 'air2' : 'air3';
      }
      return null;
    }

    function startComboStage(chain, stage) {
      if (state.dead) return false;
      const onGround = state.onGround;
      if (chain === 'light' && !onGround) return false;
      if (chain === 'air' && onGround) return false;
      const name = getComboAnimKey(chain, stage);
      const meta = name ? SHEETS[name] : null;
      if (!name || !meta || !playerSprite.mgr[name]) return false;
      if (stats.stam < stats.lightCost) return false;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      setST(stats.stam - stats.lightCost);
      state.flasking = false;
      state.acting = true;
      combo.chain = chain;
      combo.nextChain = null;
      combo.lastChain = chain;
      combo.stage = stage;
      combo.queued = false;
      combo.chainSwapQueued = false;
      combo.pendingHit = false;
      combo.hitMeta = null;
      combo.hitAt = 0;
      setAnim(name, false);
      const now = performance.now();
      combo.endAt = now + playerSprite.animDurationMs;
      combo.cancelAt = now + playerSprite.animDurationMs * (meta.cancelFrac ?? 0.6);
      combo.lastChainAt = now;
      const attackDef = PLAYER_ATTACKS[name];
      if (attackDef) {
        const animDur = playerSprite.animDurationMs || ((meta.frames / meta.fps) * 1000);
        const frac = attackDef.hitFrac ?? 0.45;
        combo.pendingHit = true;
        combo.hitAt = now + animDur * frac;
        combo.hitMeta = { attackId: name, stage, chain };
      }
      return true;
    }

    function tryStartLight() {
      if (state.dead || state.rolling) return;
      if (combo.stage > 0) {
        combo.queued = true;
        combo.chainSwapQueued = true;
        return;
      }
      const chain = state.onGround ? 'light' : 'air';
      startComboStage(chain, 1);
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
      combo.pendingHit = false;
      combo.hitMeta = null;
      combo.hitAt = 0;
      combo.chain = null;
      combo.nextChain = null;
      combo.chainSwapQueued = false;
      combo.lastChain = null;
      combo.lastChainAt = 0;
      if (!keepActing) state.acting = false;
    }

    function startHeavyCharge() {
      if (heavy.charging || heavy.releasing) return;
      if (state.dead || state.rolling) return;
      if (!state.onGround) return;
      if (state.acting && !state.flasking) return;
      if (!playerSprite.mgr.heavy) return;
      if (stats.stam < stats.heavyCost) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      state.flasking = false;
      state.acting = true;
      combo.nextChain = null; combo.chainSwapQueued = false; combo.chain = null; combo.lastChain = null; combo.lastChainAt = 0; combo.stage = 0; combo.queued = false; combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
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
      heavy.lastHoldMs = holdMs;
      heavy.lastDamage = heavy.releaseDamage;
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
        damage: heavy.releaseDamage
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
      terminateRollState();
      if (opts.event && opts.event.applyDamage === false && !opts.force) return;
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      resetHeavyState({ keepActing: true });
      state.airFlipActive = false;
      state.airFlipUntil = 0;
      if (!opts.alreadyApplied) setHP(stats.hp - dmg);
      applyImpactEffects({ hitstopMs: HITSTOP_HURT_MS, shakeMagnitude: CAMERA_SHAKE_MAG * 1.05, shakeDurationMs: CAMERA_SHAKE_DURATION_MS * 1.1 });
      const suppressFx = fadeEl?.classList?.contains('show');
      if (!suppressFx) {
        const baseSprite = playerSprite.sprite;
        const basePos = baseSprite ? baseSprite.position : placeholder.position;
        const baseZ = (basePos && typeof basePos.z === 'number') ? basePos.z : 0;
        const renderGroup = baseSprite && typeof baseSprite.renderingGroupId === 'number'
          ? baseSprite.renderingGroupId
          : null;
        const scaleUnits = playerSprite.sizeUnits * HURT_FX_SCALE;
        const fxX = basePos.x;
        const fxY = torsoCenterY();
        const facing = state.facing >= 0 ? 1 : -1;
        fxHurt.spawn(fxX, fxY, scaleUnits, facing, baseZ, renderGroup);
      }
      if (stats.hp <= 0) { die(); return; }
      state.flasking = false;
      state.acting = true; combo.nextChain = null; combo.chainSwapQueued = false; combo.chain = null; combo.lastChain = null; combo.lastChainAt = 0; combo.stage = 0; combo.queued = false;
      combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
      setAnim('hurt', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }
    function die() {
      if (state.dead) return;
      terminateRollState();
      if (state.flasking) cleanupFlaskState({ keepActing: true });
      resetHeavyState({ keepActing: true });
      state.airFlipActive = false;
      state.airFlipUntil = 0;
      state.airJumpsRemaining = 1;
      state.dead = true; state.acting = true; state.flasking = false; state.vx = 0; state.vy = 0;
      combo.nextChain = null; combo.chainSwapQueued = false; combo.chain = null; combo.lastChain = null; combo.lastChainAt = 0; combo.stage = 0; combo.queued = false; combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
      setAnim('death', false);
      actionEndAt = performance.now() + playerSprite.animDurationMs;
    }

    function startRespawn() {
      fadeEl.classList.add('show');
      setTimeout(() => {
        terminateRollState();
        placeholder.position.x = respawn.x;
        placeholder.position.y = respawn.y;
        state.vx = 0; state.vy = 0; state.onGround = true;
        state.airJumpsRemaining = 1;
        state.airFlipActive = false;
        state.airFlipUntil = 0;
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
      const heavyHoldMs = heavy.charging ? heavy.chargeHoldMs : heavy.lastHoldMs;
      const heavyHoldSec = heavyHoldMs / 1000;
      const heavyDmg = heavy.releasing ? heavy.releaseDamage : (heavy.lastDamage || stats.heavyDamage);
      const heavyChargedDisplay = heavy.charging ? heavy.charged : (heavy.lastHoldMs >= HEAVY_CHARGE_MIN_MS && heavy.lastHoldMs > 0);
      const hitstopMs = hitstopRemaining(now);
      overlayEl.textContent =
        `FPS:${engine.getFps().toFixed(0)}  Cam:ORTHO h=${ORTHO_VIEW_HEIGHT}\n` +
        `Anim:${playerSprite.state} loop:${playerSprite.loop}  size:${playerSprite.sizeUnits?.toFixed(2)} base:${playerSprite.baselineUnits?.toFixed(3)}\n` +
        `Y:${playerSprite.sprite?.position.y.toFixed(2)} FeetCenter:${feetCenterY().toFixed(2)} Ground:0 Air:${!state.onGround}\n` +
        `HP:${Math.round(stats.hp)}/${stats.hpMax}  ST:${Math.round(stats.stam)}  Dead:${state.dead}\n` +
        `vx:${state.vx.toFixed(2)} vy:${state.vy.toFixed(2)}  Roll:${state.rolling} Acting:${state.acting} Combo(stage:${combo.stage} queued:${combo.queued})\n` +
        `Heavy:charging:${heavy.charging} releasing:${heavy.releasing} hold:${heavyHoldSec.toFixed(2)}s ratio:${heavy.chargeRatio.toFixed(2)} charged:${heavyChargedDisplay} dmg:${heavyDmg.toFixed(0)}\n` +
        `Hitstop:${hitstopMs.toFixed(0)}ms  CamShake:${cameraShake.enabled} (active:${cameraShake.active})\n` +
        (enemyDbg ? enemies.map((e,i)=>`E${i}:${e.type} st:${e.state||e.anim} x:${e.x.toFixed(2)} y:${e.y.toFixed(2)}`).join('\n') + '\n' : '') +
        `[F6] camShake:${cameraShake.enabled}  |  [F7] slowMo:${slowMo}  |  [F8] colliders:${showColliders}  |  [F9] overlay  |  [F10] enemyDbg  |  A/D move, Space jump, L roll, J light, K heavy, F flask, E interact, Shift run  |  Debug: H hurt X die`;
    }

    // === Game loop ===
    engine.runRenderLoop(() => {
      const now = performance.now();
      const rawDt = Math.min(engine.getDeltaTime() / 1000, MAX_FRAME_DT);
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
        const stageId = combo.stage || combo.hitMeta?.stage || 1;
        const chainId = combo.chain || combo.hitMeta?.chain || (state.onGround ? 'light' : 'air');
        const attackId = combo.hitMeta?.attackId || getComboAnimKey(chainId, stageId) || `${chainId}${stageId}`;
        const meta = combo.hitMeta || { attackId, stage: stageId, chain: chainId };
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
        if (want !== 0 && !state.rolling) state.facing = want;

        const speedMax = Keys.runHold ? stats.runMax : stats.walkMax;
        const target = want * speedMax;
        const a = (Math.abs(target) > Math.abs(state.vx)) ? stats.accel : stats.decel;
        if (state.vx < target) state.vx = Math.min(target, state.vx + a * dt);
        else if (state.vx > target) state.vx = Math.max(target, state.vx - a * dt);

        const canCoyote = (now - state.lastGrounded) <= stats.coyoteTime * 1000;
        const buffered = (now - state.jumpBufferedAt) <= stats.inputBuffer * 1000;
        if (buffered && !state.rolling) {
          if (state.onGround || canCoyote) {
            state.vy = stats.jumpVel;
            state.onGround = false;
            state.jumpBufferedAt = 0;
            state.landing = false;
            state.landingStartAt = 0;
            state.landingUntil = 0;
            state.landingTriggeredAt = 0;
          } else if (!state.onGround && state.airJumpsRemaining > 0) {
            triggerDoubleJump(now);
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
        const rollFacing = (typeof state.rollFacing === 'number') ? state.rollFacing : (state.facing >= 0 ? 1 : -1);
        state.vx = rollFacing * stats.rollSpeed;
        const inWindow = state.rollInvulnDuration > 0 && now >= state.rollInvulnStartAt && now < state.rollInvulnEndAt;
        if (inWindow && !state.rollInvulnApplied) {
          const remaining = Math.max(0, state.rollInvulnEndAt - now);
          state.rollInvulnApplied = true;
          state.iFramed = true;
          Combat.setInvulnerable(playerActor, 'roll', true, remaining || state.rollInvulnDuration);
        } else if (!inWindow && state.rollInvulnApplied) {
          state.rollInvulnApplied = false;
          state.iFramed = false;
          Combat.setInvulnerable(playerActor, 'roll', false);
        } else {
          state.iFramed = inWindow;
        }
        if (state.rollT >= stats.rollDur) {
          terminateRollState({ resetVelocity: false });
        }
      } else if (state.rollInvulnApplied || state.iFramed) {
        terminateRollState({ resetVelocity: false });
      }

      // Light/Heavy/Flask/Debug
      if (Keys.light) { tryStartLight(); Keys.light = false; }
      if (Keys.flask) { tryFlask(); Keys.flask = false; }
      if (Keys.debugHurt) { triggerHurt(15); Keys.debugHurt = false; }
      if (Keys.debugDie)  { die(); Keys.debugDie = false; }

      // Handle combo progression
      if (combo.stage > 0 && now >= combo.endAt) {
        const chainId = combo.chain || combo.lastChain || (state.onGround ? 'light' : 'air');
        const currentKey = getComboAnimKey(chainId, combo.stage);
        const currentMeta = currentKey ? SHEETS[currentKey] : null;
        const desiredChain = state.onGround ? 'light' : 'air';
        let advanced = false;

        const overrideChain = (combo.nextChain && combo.nextChain !== combo.chain) ? combo.nextChain : null;
        const allowChainSwap = combo.chainSwapQueued;
        if (overrideChain && allowChainSwap) {
          advanced = startComboStage(overrideChain, 1);
          if (advanced) {
            combo.nextChain = null;
            combo.chainSwapQueued = false;
          }
        }

        if (!advanced) {
          if (chainId !== desiredChain && allowChainSwap) {
            advanced = startComboStage(desiredChain, 1);
            if (advanced) {
              combo.nextChain = null;
              combo.chainSwapQueued = false;
            }
          } else if (combo.queued && currentMeta?.next) {
            const nextStage = combo.stage + 1;
            advanced = startComboStage(chainId, nextStage);
          }
        }

        if (!advanced) {
          combo.lastChain = chainId;
          combo.lastChainAt = now;
          if (!allowChainSwap) combo.nextChain = null;
          combo.chain = null;
          combo.stage = 0;
          combo.queued = false;
          if (!allowChainSwap) combo.chainSwapQueued = false;
          combo.pendingHit = false; combo.hitMeta = null; combo.hitAt = 0;
          state.acting = false;
        }
      }
      // Handle generic action end (hurt, heavy, death)
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
      }

      // Physics (drive placeholder)
      const wasOnGround = state.onGround;
      let vyBefore = state.vy;
      if (!state.dead) {
        state.vy += stats.gravity * dt;
        vyBefore = state.vy;
        placeholder.position.x += state.vx * dt;
        placeholder.position.y += state.vy * dt;
      }

      // Ground clamp (feet at y=0 => center at feetCenterY)
      const groundCenter = feetCenterY();
      let justLanded = false;
      if (placeholder.position.y <= groundCenter) {
        placeholder.position.y = groundCenter;
        if (!state.onGround) state.lastGrounded = now;
        state.onGround = true;
        state.airJumpsRemaining = 1;
        state.airFlipActive = false;
        state.airFlipUntil = 0;
        if (state.vy < 0) state.vy = 0;
        justLanded = !wasOnGround;
      } else {
        state.onGround = false;
      }

      const justAirborne = !state.onGround && wasOnGround;

      if (!state.dead && !state.rolling) {
        if (combo.stage > 0) {
          if (justLanded && combo.chain !== 'light') combo.nextChain = 'light';
          else if (justAirborne && combo.chain !== 'air') combo.nextChain = 'air';
        } else {
          const timeSinceLast = now - combo.lastChainAt;
          if (timeSinceLast <= COMBO_TRANSITION_GRACE_MS) {
            if (justLanded && combo.lastChain === 'air') combo.nextChain = 'light';
            else if (justAirborne && combo.lastChain === 'light') combo.nextChain = 'air';
          }
        }
      }

      if (!state.dead && !state.rolling && combo.stage === 0 && combo.nextChain) {
        const desired = combo.nextChain;
        const canStart = (desired === 'light' && state.onGround) || (desired === 'air' && !state.onGround);
        let started = false;
        if (canStart && combo.chainSwapQueued) {
          started = startComboStage(desired, 1);
          if (started) {
            combo.nextChain = null;
            combo.chainSwapQueued = false;
          }
        }
        if (!started) {
          const sinceLast = now - combo.lastChainAt;
          if (sinceLast > COMBO_TRANSITION_GRACE_MS) {
            combo.nextChain = null;
            combo.chainSwapQueued = false;
          }
        }
      }

      if (justLanded) {
        spawnLandSmokeFx(now);
        const landingMeta = SHEETS.landing;
        const falling = vyBefore < -0.2;
        const jumpBuffered = state.jumpBufferedAt &&
          (now - state.jumpBufferedAt) <= stats.inputBuffer * 1000;
        const jumpPressedRecently = state.lastJumpPressAt &&
          (now - state.lastJumpPressAt) <= LANDING_SPAM_GRACE_MS;
        const canTriggerLanding = falling && landingMeta && playerSprite.mgr.landing && playerSprite.sprite &&
          !state.rolling && (!state.acting || state.flasking) && !state.dead &&
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
        const facingForSprite = state.rolling ? ((typeof state.rollFacing === 'number') ? state.rollFacing : (state.facing >= 0 ? 1 : -1)) : state.facing;
        playerSprite.sprite.position.x = placeholder.position.x;
        playerSprite.sprite.position.y = placeholder.position.y;
        playerSprite.sprite.invertU = (facingForSprite < 0);
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
      fxHit.update(now);
      fxHurt.update(now);
      fxLandSmoke.update(now);
      fxDoubleJumpSmoke.update(now);
      fxRollSmoke.update(now);
      SpriteFlash.update(now);

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
        const eligibleNow = state.onGround && (!state.acting || state.flasking) && !state.dead &&
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

      if (state.airFlipActive && now >= state.airFlipUntil) {
        state.airFlipActive = false;
        state.airFlipUntil = 0;
      }

      const allowStateMachine = !state.rolling && !state.acting && !state.dead && playerSprite.sprite && !state.airFlipActive;
      if (allowStateMachine) {
        let targetAnim = 'idle';

        if (landingActive) {
          targetAnim = 'landing';
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

    console.log('[EotR] Phase 2.3.1 boot OK');
  } catch (err) {
    console.error('Boot error:', err);
    alert('Boot error (see console for details).');
  }
})();
