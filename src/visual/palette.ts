type RGB = [number, number, number]

const chordPalette: Record<string, RGB> = {
  C: [1, 0.2, 0.55],
  G: [0.25, 0.32, 0.95],
  Am: [0.95, 0.95, 0.35],
  F: [0.5, 0.75, 1],
  Dm: [1, 0.5, 0.9],
  Em: [0.35, 0.95, 1],
  'G/B': [1, 0.66, 0.25],
  'C/E': [0.5, 1, 0.35]
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

export const hslToRgb = (h: number, s: number, l: number): RGB => {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m]
}

export const noteToColor = (note: number): RGB => {
  const hue = (note * 22) % 360
  return hslToRgb(hue, 0.7, 0.6)
}

export const chordToColor = (chordName: string): RGB => {
  if (chordPalette[chordName]) return chordPalette[chordName]
  return noteToColor(chordName.length * 7)
}

export const mixColors = (a: RGB, b: RGB, t: number): RGB => {
  const mix = (x: number, y: number) => x + (y - x) * t
  return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
}

export const boostColor = (color: RGB, amount: number): RGB => {
  return [
    clamp(color[0] + amount),
    clamp(color[1] + amount),
    clamp(color[2] + amount)
  ]
}
