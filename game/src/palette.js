// The look plan, in one place. The palette is a decommissioned refinery at dusk: cold concrete
// and steel, one warm sodium accent. The same six names are the CSS custom properties in
// index.html, so the HUD and the world never drift apart.
export const PALETTE = {
  canvas: '#101318',
  surface: '#1d232b',
  hairline: '#3a4552',
  ink: '#c9c2b4',
  muted: '#8a94a0',
  accent: '#e89322',
};

export function shade(name) {
  return PALETTE[name];
}
