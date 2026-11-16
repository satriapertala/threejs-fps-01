// The DOM HUD: health, armor, ammo, money, round timer, score, kill feed, dynamic crosshair,
// progress bar (defuse), banner messages and the overlay panel. It writes only when a value
// changes; it never touches the simulation.
const OVERLAY = {
  start: {
    title: 'SECTOR 9',
    copy: 'Round-based tactical FPS. Defend Sector 9 with your squad against an attacking cell ' +
      'that plants charges on Site A or B. Money between rounds, buy better gear, hold the sector: ' +
      'first team to 5 rounds wins.',
    action: 'Click to play',
  },
  paused: { title: 'PAUSED', copy: 'The round keeps only when you play. Click to resume.', action: 'Resume' },
  dead: { title: 'YOU DIED', copy: 'Spectating the planted charge. Next round soon.', action: '' },
  matchover: { title: 'MATCH OVER', copy: '', action: 'Play again' },
};

export function createHud() {
  const el = {
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    copy: document.getElementById('overlay-copy'),
    play: document.getElementById('play'),
    health: document.getElementById('health'),
    healthBar: document.getElementById('healthbar-i'),
    armor: document.getElementById('armor'),
    mag: document.getElementById('ammo-mag'),
    reserve: document.getElementById('ammo-reserve'),
    weaponName: document.getElementById('weaponname'),
    money: document.getElementById('money'),
    timer: document.getElementById('timer'),
    scoreT: document.getElementById('score-t'),
    scoreCT: document.getElementById('score-ct'),
    roundLabel: document.getElementById('roundlabel'),
    killFeed: document.getElementById('killfeed'),
    crosshair: document.getElementById('crosshair'),
    hitmarker: document.getElementById('hitmarker'),
    progress: document.getElementById('progress'),
    progressLabel: document.getElementById('progress-label'),
    progressBar: document.getElementById('progress-i'),
    banner: document.getElementById('banner'),
    buymenu: document.getElementById('buymenu'),
    damageflash: document.getElementById('damageflash'),
  };
  let last = { health: -1, armor: -1, mag: -1, reserve: -1, money: -1, timer: '', score: '', feedLen: -1 };
  let hitTimer = 0;
  let bannerTimer = 0;
  let buyHandlers = null;
  let flashTimer = 0;

  el.play.addEventListener('click', () => hud.onPlayHandler?.());

  const hud = {
    onPlayHandler: null,
    onPlay(fn) { hud.onPlayHandler = fn; },
    setBuyHandlers(h) {
      buyHandlers = h;
      document.getElementById('buy-rifle').addEventListener('click', () => h.rifle());
      document.getElementById('buy-armor').addEventListener('click', () => h.armor());
      document.getElementById('buy-grenade').addEventListener('click', () => h.grenade());
      document.getElementById('buy-ammo').addEventListener('click', () => h.ammo());
    },
    refreshBuy(player) {
      const open = player.alive && !hud.buyForcedHidden;
      const buyOpen = el.buymenu.style.display === 'block';
      if (!open && buyOpen) el.buymenu.style.display = 'none';
      document.getElementById('buy-rifle').disabled = player.hasRifle || player.money < 2700;
      document.getElementById('buy-armor').disabled = player.armor >= 100 || player.money < 1000;
      document.getElementById('buy-grenade').disabled = player.grenades >= 2 || player.money < 300;
      document.getElementById('buy-ammo').disabled = player.money < 200;
    },
    toggleBuy() {
      const show = el.buymenu.style.display !== 'block';
      el.buymenu.style.display = show ? 'block' : 'none';
      hud.buyForcedHidden = false;
    },
    showOverlay(kind) {
      if (kind === 'none') { el.overlay.hidden = true; return; }
      const copy = OVERLAY[kind] ?? OVERLAY.start;
      el.title.textContent = copy.title;
      el.copy.textContent = kind === 'matchover' ? hud.lastWinnerText || copy.copy : copy.copy;
      el.play.textContent = copy.action;
      el.play.hidden = kind === 'dead';
      el.overlay.hidden = false;
    },
    hideOverlay() { el.overlay.hidden = true; },
    setHealth(health, armor, alive) {
      if (health !== last.health) {
        last.health = health;
        el.health.textContent = Math.max(0, Math.round(health));
        el.healthBar.style.width = Math.max(0, Math.min(100, health)) + '%';
        el.damageflash.style.opacity = 0;
      }
      if (armor !== last.armor) { last.armor = armor; el.armor.textContent = Math.round(armor); }
    },
    setAmmo(mag, reserve, weaponName) {
      if (mag !== last.mag) { last.mag = mag; el.mag.textContent = mag; }
      if (reserve !== last.reserve) { last.reserve = reserve; el.reserve.textContent = '/ ' + reserve; }
      if (weaponName !== last.weapon) { last.weapon = weaponName; el.weaponName.textContent = weaponName; }
    },
    setMoney(money) {
      if (money === last.money) return;
      last.money = money;
      el.money.textContent = '$ ' + money;
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      const label = phase === 'buy' ? 'BUY ' + text : phase === 'planted' ? 'BOMB ' + text : text;
      if (label !== last.timer) {
        last.timer = label;
        el.timer.textContent = label;
        el.timer.classList.toggle('danger', phase === 'planted' || s < 15);
      }
    },
    setScore(t, ct, round) {
      const key = `${t}-${ct}-${round}`;
      if (key === last.score) return;
      last.score = key;
      el.scoreT.textContent = t;
      el.scoreCT.textContent = ct;
      el.roundLabel.textContent = `ROUND ${round} · FIRST TO ${5}`;
    },
    setKillFeed(feed) {
      if (feed.length === last.feedLen) return;
      last.feedLen = feed.length;
      el.killFeed.innerHTML = feed
        .map((k) => `<div><b>${k.killer}</b> ${k.headshot ? '<span class="hs">◉ HS</span> ' : ''}→ ${k.victim}</div>`)
        .join('');
    },
    setCrosshairSpread(spread) {
      const gap = Math.round(8 + spread * 900);
      el.crosshair.style.setProperty('--gap', Math.min(16, gap) + 'px');
    },
    hitMarker(headshot) {
      el.hitmarker.classList.add('on');
      hitTimer = 0.12;
    },
    setProgress(fraction, label) {
      el.progress.style.display = fraction > 0 ? 'block' : 'none';
      if (label) el.progressLabel.textContent = label;
      el.progressBar.style.width = Math.round(fraction * 100) + '%';
    },
    setBanner(text, phase) {
      hud.lastWinnerText = text;
      if (phase === 'roundover' && text) {
        el.banner.textContent = text;
        el.banner.classList.add('on');
        bannerTimer = 4;
      } else if (phase === 'matchover') {
        el.banner.textContent = text;
        el.banner.classList.add('on');
        bannerTimer = 999;
      }
    },
    flashBanner(text) {
      if (!text) return;
      el.banner.textContent = text;
      el.banner.classList.add('on');
      bannerTimer = 2.2;
    },
    // per-frame decay timers; called from main's render pass
    tick() {
      if (hitTimer > 0) { hitTimer -= 1 / 60; if (hitTimer <= 0) el.hitmarker.classList.remove('on'); }
      if (bannerTimer > 0 && bannerTimer < 900) { bannerTimer -= 1 / 60; if (bannerTimer <= 0) el.banner.classList.remove('on'); }
    },
  };
  return hud;
}
