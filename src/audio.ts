// Original, short WebAudio motifs. No context is created until a real user
// gesture calls unlock(); blocked/unsupported audio never blocks the game.
export type Cue =
  | "launch"
  | "impact"
  | "break"
  | "income"
  | "ammo"
  | "alarm"
  | "win"
  | "plant";
class GardenAudio {
  private context?: AudioContext;
  private voices = new Set<OscillatorNode>();
  volume = 0.45;
  muted = false;
  reduceShake = false;
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => undefined);
    } catch {
      /* Audio is optional. */
    }
  }
  play(cue: Cue): void {
    const ctx = this.context;
    if (
      !ctx ||
      ctx.state !== "running" ||
      this.muted ||
      this.volume === 0 ||
      this.voices.size > 12
    )
      return;
    const notes: Record<Cue, number[]> = {
      launch: [360, 660],
      impact: [140],
      break: [300, 180, 90],
      income: [740, 980],
      ammo: [520, 780, 1040],
      alarm: [330, 220, 330],
      win: [523, 659, 784, 1046],
      plant: [260, 390],
    };
    notes[cue].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.07;
      osc.type = cue === "break" || cue === "alarm" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(frequency, t);
      osc.frequency.exponentialRampToValueAtTime(
        frequency * (cue === "impact" ? 0.35 : 1.08),
        t + 0.1,
      );
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(this.volume * 0.09, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      this.voices.add(osc);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        this.voices.delete(osc);
      };
      osc.start(t);
      osc.stop(t + 0.16);
    });
  }
  stop(): void {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.voices.clear();
  }
}
export const gardenAudio = new GardenAudio();
