// Keyboard and mouse, and the pointer lock that turns the mouse into look. Also the single
// home of one-shot key edges (buy menu, weapon switch, grenade throw) read by the sim.
export function createInput(canvas, onLockChange, hooks) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  const PRESS_HOOKS = {
    Digit1: () => hooks.switchWeapon(0),
    Digit2: () => hooks.switchWeapon(1),
    Digit3: () => hooks.switchWeapon(2),
    KeyG: () => hooks.throwGrenade(),
    KeyB: () => hooks.toggleBuy(),
    KeyE: () => hooks.interact(),
    KeyR: () => hooks.reload(),
  };

  function setKey(event, down) {
    if (down) {
      keys.add(event.code);
      if (state.locked && PRESS_HOOKS[event.code]) PRESS_HOOKS[event.code]();
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'KeyE' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('wheel', () => {}, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    down(code) {
      return keys.has(code);
    },
  };
}
