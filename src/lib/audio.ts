class AudioController {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playMove(isMyMove: boolean) {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    // Opponent moves have a slightly lower pitch
    osc.frequency.setValueAtTime(isMyMove ? 600 : 400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playMessage() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.02);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playWin() {
    this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880]; // A major chord arpeggio
    
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      gain.gain.setValueAtTime(0, t + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.3, t + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, t + i * 0.1 + 0.5);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(t + i * 0.1);
      osc.stop(t + i * 0.1 + 0.5);
    });
  }

  playLose() {
    this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [400, 380, 360, 300]; // descending minor-ish feel
    
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t + i * 0.2);
      osc.frequency.exponentialRampToValueAtTime(freq - 50, t + i * 0.2 + 0.3);
      
      gain.gain.setValueAtTime(0, t + i * 0.2);
      gain.gain.linearRampToValueAtTime(0.2, t + i * 0.2 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, t + i * 0.2 + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(t + i * 0.2);
      osc.stop(t + i * 0.2 + 0.3);
    });
  }
}

export const audio = new AudioController();
