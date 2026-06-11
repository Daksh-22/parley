import { memo } from 'react';

// Deterministic identicon: the avatarSeed assigned at signup hashes to a hue
// and a symmetric 5x5 pattern. Saturation is kept low so avatars read like
// ink stamps on paper in both themes, and a user looks identical everywhere.

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const Avatar = memo(function Avatar({
  seed,
  name,
  size = 28,
  online,
}: {
  seed: string;
  name: string;
  size?: number;
  online?: boolean;
}) {
  const hash = fnv1a(seed);
  const hue = hash % 360;
  const bg = `hsl(${hue} 22% 84%)`;
  const fg = `hsl(${hue} 30% 30%)`;

  const cells: boolean[] = [];
  for (let i = 0; i < 15; i += 1) cells.push(((hash >> (i % 31)) & 1) === 1);

  const rects = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const sourceCol = col < 3 ? col : 4 - col;
      if (cells[row * 3 + sourceCol]) {
        rects.push(<rect key={`${row}-${col}`} x={col + 1} y={row + 1} width={1} height={1} />);
      }
    }
  }

  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg
        role="img"
        aria-label={`${name} avatar`}
        viewBox="0 0 7 7"
        width={size}
        height={size}
        className="rounded-full"
        style={{ backgroundColor: bg }}
      >
        <g fill={fg}>{rects}</g>
      </svg>
      {online !== undefined && (
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-panel ${
            online ? 'bg-success' : 'bg-text-secondary opacity-50'
          }`}
        />
      )}
    </span>
  );
});
