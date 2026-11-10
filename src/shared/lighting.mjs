export function lightingFrame(time, seed, speed, active) {
  const phase = time / 1000 * speed + seed % 31 / 7;
  return { intensity: active ? .56 + .22 * Math.sin(phase * 2.2) : .045, scan: (phase * .27 % 1 + 1) % 1, angle: phase * 1.1 };
}
