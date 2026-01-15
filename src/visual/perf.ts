export type PerfAction = 'hold' | 'decrease' | 'increase'

export class FpsMonitor {
  private lastTime = performance.now()
  private frames = 0
  private accum = 0
  private avgFps = 60
  private lowStreak = 0
  private highStreak = 0

  tick(now: number) {
    const delta = now - this.lastTime
    this.lastTime = now
    this.accum += delta
    this.frames += 1
    if (this.accum >= 1000) {
      this.avgFps = (this.frames / this.accum) * 1000
      this.accum = 0
      this.frames = 0
      if (this.avgFps < 45) {
        this.lowStreak += 1
        this.highStreak = 0
      } else if (this.avgFps > 58) {
        this.highStreak += 1
        this.lowStreak = 0
      } else {
        this.lowStreak = 0
        this.highStreak = 0
      }
    }
  }

  getAction(): PerfAction {
    if (this.lowStreak >= 2) {
      this.lowStreak = 0
      return 'decrease'
    }
    if (this.highStreak >= 4) {
      this.highStreak = 0
      return 'increase'
    }
    return 'hold'
  }

  get fps() {
    return this.avgFps
  }
}
