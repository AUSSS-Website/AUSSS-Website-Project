// Brand-color helpers. Official palettes run from near-black (SCOME #100016,
// CBSD #1E1E17) to pale yellow, so `readableAccent` returns a shade of the
// colour that is legible as text in each theme: lightened for the dark forest
// surfaces, darkened for the light ones.

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const v =
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h
  const n = parseInt(v || '5b8db8', 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// WCAG relative luminance and contrast ratio.
function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// The surfaces text has the least contrast against in each theme: the dark
// theme's card (forest-800) and the light theme's band (--c-sunk).
const DARK_SURFACE = { r: 6, g: 53, b: 34 }
const LIGHT_SURFACE = { r: 240, g: 245, b: 242 }
const AA = 4.5

// A chip tinted with the accent itself (`rgba(color, 0.2)` over the surface)
// sits a little closer to the text than the bare surface does, so text on
// such a chip needs a stronger shade: see `chipAccent`.
const CHIP_TINT = 0.25

const blend = (over, under, a) => ({
  r: Math.round(over.r * a + under.r * (1 - a)),
  g: Math.round(over.g * a + under.g * (1 - a)),
  b: Math.round(over.b * a + under.b * (1 - a)),
})

// Mixes the colour toward `target` (0..255 on every channel) in small steps
// from `start` until it reaches WCAG AA against `surface` and, with `onChip`,
// against a chip of its own colour on that surface.
function mixUntilReadable(rgb, target, surface, start = 0, onChip = false) {
  const chip = onChip ? blend(rgb, surface, CHIP_TINT) : surface
  const end = { r: target, g: target, b: target }
  for (let t = start; t <= 1.001; t += 0.05) {
    const mixed = blend(end, rgb, Math.min(1, t))
    if (contrast(mixed, surface) >= AA && contrast(mixed, chip) >= AA) return mixed
  }
  return end
}

const css = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`

// A CSS colour that resolves per theme through the --theme-light and
// --theme-dark switches in index.css, so it can be used in an inline style
// (color, background, border-color) and still follow the theme, including
// inside an always-dark block.
export function readableAccent(hex, onChip = false) {
  const rgb = hexToRgb(hex)
  // On dark, a dark colour starts from a generous lift, so near-black brand
  // colours come out pale and clear, not merely passable.
  const brightness = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  const lift = brightness >= 0.34 ? 0 : brightness < 0.12 ? 0.7 : 0.5
  const onDark = mixUntilReadable(rgb, 255, DARK_SURFACE, lift, onChip)
  const onLight = mixUntilReadable(rgb, 0, LIGHT_SURFACE, 0, onChip)
  return `var(--theme-light, ${css(onLight)}) var(--theme-dark, ${css(onDark)})`
}

// The accent as text on a chip tinted with the same colour.
export const chipAccent = (hex) => readableAccent(hex, true)

export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
