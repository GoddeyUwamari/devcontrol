// WCAG 2.x contrast for the colour values used in app/globals.css and Tailwind's palette
// (node_modules/tailwindcss/theme.css): #RRGGBB, and oklch(L C h) with L as a number or a percentage.

/** Linear-light sRGB of a #RRGGBB or oklch(L C h) value. */
export function linear(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    return [0, 2, 4].map((i) => {
      const c = parseInt(hex[1].slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
  }
  const ok = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!ok) throw new Error(`unsupported colour ${value}`)
  const L = Number(ok[1]) / (ok[2] === '%' ? 100 : 1)
  const [C, h] = [Number(ok[3]), Number(ok[4])]
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** WCAG 2.x contrast ratio of two colours. */
export function contrast(x: string, y: string): number {
  const lum = (v: string) => {
    const [r, g, b] = linear(v)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}
