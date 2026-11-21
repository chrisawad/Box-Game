import confetti from "canvas-confetti";

// Arrow Cube's two cannons, overhead shower and final pair of bursts.
export function createWinCelebration(canvas: HTMLCanvasElement) {
  let fire: ReturnType<typeof confetti.create> | undefined;
  const timers = new Set<number>();
  function stop() {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    fire?.reset();
  }
  function later(delay: number, callback: () => void) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      callback();
    }, delay);
    timers.add(id);
  }
  function play() {
    stop();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const shoot = (fire ??= confetti.create(canvas, {
      resize: true,
      useWorker: true,
      disableForReducedMotion: true,
    }));
    const burst = (options: confetti.Options) =>
      shoot({
        colors: [
          "#6258f5",
          "#ffcc38",
          "#37b487",
          "#ff718b",
          "#74ccef",
          "#ffffff",
        ],
        spread: 85,
        ticks: 180,
        gravity: 1.05,
        scalar: 1.1,
        ...options,
      });
    burst({
      particleCount: 100,
      angle: 60,
      startVelocity: 55,
      origin: { x: 0.04, y: 0.8 },
    });
    burst({
      particleCount: 100,
      angle: 120,
      startVelocity: 55,
      origin: { x: 0.96, y: 0.8 },
    });
    later(260, () =>
      burst({
        particleCount: 100,
        spread: 170,
        startVelocity: 32,
        origin: { x: 0.5, y: 0.25 },
      }),
    );
    later(550, () => {
      burst({
        particleCount: 65,
        angle: 65,
        startVelocity: 42,
        origin: { x: 0.1, y: 0.65 },
      });
      burst({
        particleCount: 65,
        angle: 115,
        startVelocity: 42,
        origin: { x: 0.9, y: 0.65 },
      });
    });
    later(3800, stop);
  }
  return { play, stop };
}
