// A bounded simulation clock freezes cleanly during reduced motion and world editing.
export const advanceEnvironment = (time, delta, enabled) => time + (enabled ? Math.min(100, Math.max(0, delta)) : 0);
export function smokeOrigin(point, height, rect, spriteAnchor, chimney, mirror = false) {
  const width = height * rect[2] / rect[3];
  return [point[0] + (chimney[0] - spriteAnchor[0]) * width * (mirror ? -1 : 1), point[1] + (chimney[1] - spriteAnchor[1]) * height];
}
export function smokePuffs(time, seed, scale = 1, speed = 1) {
  return Array.from({ length: 6 }, (_, i) => {
    const age = ((time * speed + seed % 5100) / 5100 + i / 6) % 1;
    return { x: (age * 11 + Math.sin(age * 5 + seed) * age * 2.5) * scale, y: (-age * 42 - 1) * scale, radius: (2.2 + age * 5) * scale, opacity: .58 * (1 - age) ** 1.1 };
  });
}
export function waterStreaks(time, seed, speed = 1) {
  return Array.from({ length: 4 }, (_, i) => {
    const phase = ((time * speed / 2800 + (seed % 97) / 97 + i / 4) % 1);
    return { along: phase * 2 - 1, across: ((seed * 7 + i * 29) % 101) / 100 - .5, opacity: Math.sin(phase * Math.PI) * .65 };
  });
}
