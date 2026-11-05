// Sound effects: the original ufile_<id>.wav files, played through
// small per-effect pools so rapid repeats overlap, like SoundPlayer
// (Swift/AVAudioPlayer) did. No synthesised replacement sounds.
export const SOUND_FILES = Object.freeze({
  die: 'assets/sounds/ufile_2000.wav',
  pass: 'assets/sounds/ufile_2001.wav',
  jump: 'assets/sounds/ufile_2002.wav',
  highScore: 'assets/sounds/ufile_2003.wav',
  click: 'assets/sounds/ufile_2002.wav', // EF_CLICK_BUTTON reuses jump
});

export class SoundPlayer {
  constructor({ muted = false } = {}) {
    this.isMuted = muted;
    this.voicesPerEffect = 4;
    this.pools = {};
    this.nextIndex = {};
    for (const [name, src] of Object.entries(SOUND_FILES)) {
      this.pools[name] = [];
      this.nextIndex[name] = 0;
      for (let i = 0; i < this.voicesPerEffect; i++) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        this.pools[name].push(audio);
      }
    }
  }

  // The first play happens inside a user gesture (flap / button tap),
  // which is what unlocks audio in browsers; later plays follow.
  play(name) {
    if (this.isMuted) return;
    const pool = this.pools[name];
    if (!pool || pool.length === 0) return;
    const audio = pool[this.nextIndex[name]];
    this.nextIndex[name] = (this.nextIndex[name] + 1) % pool.length;
    audio.currentTime = 0;
    const p = audio.play();
    if (p) p.catch(() => {});
  }
}
