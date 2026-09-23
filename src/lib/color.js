// Brand-color helpers. Official palettes include near-black values
// (SCOME #100016, CBSD #1E1E17), so `readableAccent` lightens anything
// too dark to stay legible on the dark forest theme.

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

export function readableAccent(hex) {
  const { r, g, b } = hexToRgb(hex)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (lum >= 0.34) return `rgb(${r}, ${g}, ${b})`
  const t = lum < 0.12 ? 0.7 : 0.5 // mix toward white
  const mix = (c) => Math.round(c + (255 - c) * t)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
