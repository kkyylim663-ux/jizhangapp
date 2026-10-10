// color.ts（ui 内部色值小工具）
// T03–T05 的组件需要「一个语义色 + 指定透明度」的淡底（选中胶囊、危险按钮底、徽章底…），
// 令牌里只给了几种固定淡底（accentSoft 等），其余按需从语义色派生，避免再写死色值。
//
// 用法：withAlpha(semantic.danger, 0.10)

/** hex / rgba 色值 → 指定 alpha 的 rgba（无法解析时原样返回，绝不抛错） */
export function withAlpha(color: string, alpha: number): string {
  const value = color.trim();
  if (value.startsWith('#')) {
    const hex =
      value.length === 4
        ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
        : value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return value;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (value.startsWith('rgba(')) {
    return value.replace(/rgba\(([^)]+)\)/, (_match, parts: string) => {
      const [r, g, b] = parts.split(',').map((p) => p.trim());
      return `rgba(${r},${g},${b},${alpha})`;
    });
  }
  return value;
}

/** hex → { r, g, b }（0-255）；解析失败返回 null */
export function parseHex(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  if (!value.startsWith('#')) return null;
  const hex =
    value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

/** 与白色混合（t=0 原色，t=1 纯白）：类别图标托的日间淡底用（色值 ≈ 原色混白 86%） */
export function mixWithWhite(color: string, t: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return rgbToHex(mix(rgb.r), mix(rgb.g), mix(rgb.b));
}

/** RGB（0-255）→ '#rrggbb' */
export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** hex → HSL（h 0-360, s 0-1, l 0-1）；解析失败返回 null */
export function hexToHsl(color: string): { h: number; s: number; l: number } | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** HSL → 6 位 hex（h 0-360, s/l 0-1） */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * UI V2 类别色 → 图标托专用色对（夜间取原色，日间取稿里的「同色系压实」）：
 * - 夜间：底 = 类别色 15% / 图标 = 类别色提亮（混白 18%）
 * - 日间：底 = 类别色混白 86%（近白淡底）/ 图标 = 同色相、降明度（l×0.8）压实
 * ⚠ 日间图标色是从稿里 8 组取样反推的近似公式（hue 精确、明度 ±0.06），
 *   个别类别若要逐像素对齐，页面上以显式色值覆盖即可。
 */
export function categoryIconTint(color: string, isDark: boolean): { bg: string; fg: string } {
  if (isDark) {
    return { bg: withAlpha(color, 0.15), fg: mixWithWhite(color, 0.18) };
  }
  const hsl = hexToHsl(color);
  if (!hsl) return { bg: mixWithWhite(color, 0.86), fg: color };
  return {
    bg: mixWithWhite(color, 0.86),
    fg: hslToHex(hsl.h, Math.min(hsl.s + 0.1, 1), hsl.l * 0.8),
  };
}
