// Arrow Cube's brass harmonics, note envelopes and final C-major chord.
function trumpet(
  context: AudioContext,
  wave: PeriodicWave,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
) {
  const horn = context.createOscillator(),
    vibrato = context.createOscillator();
  const filter = context.createBiquadFilter(),
    gain = context.createGain(),
    depth = context.createGain();
  horn.setPeriodicWave(wave);
  horn.frequency.setValueAtTime(frequency * 0.994, start);
  horn.frequency.linearRampToValueAtTime(frequency, start + 0.025);
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(frequency * 2, start);
  filter.frequency.exponentialRampToValueAtTime(frequency * 9, start + 0.025);
  filter.frequency.exponentialRampToValueAtTime(
    frequency * 4,
    start + duration,
  );
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.linearRampToValueAtTime(volume * 0.7, start + 0.065);
  gain.gain.setValueAtTime(volume * 0.65, start + duration - 0.045);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  vibrato.frequency.value = 5.4;
  depth.gain.setValueAtTime(0, start);
  depth.gain.linearRampToValueAtTime(
    frequency * 0.004,
    start + Math.min(0.25, duration * 0.8),
  );
  vibrato.connect(depth).connect(horn.frequency);
  horn.connect(filter).connect(gain).connect(context.destination);
  horn.onended = () => {
    for (const node of [horn, vibrato, depth, filter, gain]) node.disconnect();
  };
  horn.start(start);
  vibrato.start(start);
  horn.stop(start + duration + 0.01);
  vibrato.stop(start + duration + 0.01);
  return () => {
    gain.disconnect();
    horn.stop();
    vibrato.stop();
  };
}

export function createWinAudio() {
  const stops: (() => void)[] = [];
  function stop() {
    for (const silence of stops.splice(0)) silence();
  }
  function play(context: AudioContext) {
    stop();
    const start = context.currentTime;
    const harmonics = new Float32Array([
      0, 1, 0.8, 0.55, 0.4, 0.25, 0.18, 0.12, 0.09, 0.07, 0.05, 0.04,
    ]);
    const wave = context.createPeriodicWave(
      new Float32Array(harmonics.length),
      harmonics,
    );
    for (const [hz, at, duration, level] of [
      [392, 0, 0.14, 0.07],
      [392, 0.18, 0.14, 0.07],
      [392, 0.36, 0.14, 0.07],
      [523.25, 0.57, 0.2, 0.07],
      [659.25, 0.82, 0.2, 0.07],
      [783.99, 1.07, 0.85, 0.07],
      [523.25, 1.07, 0.85, 0.018],
      [659.25, 1.07, 0.85, 0.018],
    ]) {
      stops.push(trumpet(context, wave, hz, start + at, duration, level));
    }
  }
  return { play, stop };
}
