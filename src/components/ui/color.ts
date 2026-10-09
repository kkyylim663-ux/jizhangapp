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
