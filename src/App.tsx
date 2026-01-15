import { useEffect, useMemo, useRef, useState } from 'react'
import ParticleSea from './visual/ParticleSea'
import { emitVisual } from './visual/visualBus'

type Chord = {
  name: string
  label: string
  glow: string
  notes: number[]
}

type AudioStore = {
  audioCtx: AudioContext | null
  masterGain: GainNode | null
  masterBus: GainNode | null
  saturator: WaveShaperNode | null
  compressor: DynamicsCompressorNode | null
  delaySend: GainNode | null
  delayNode: DelayNode | null
  delayFeedback: GainNode | null
  delayFilter: BiquadFilterNode | null
  noiseBuffer: AudioBuffer | null
  currentChordVoice: { stop: (release?: number) => void } | null
  currentChordName: string | null
  beatRunning: boolean
  schedulerTimer: number | null
  nextStepTime: number
  stepIndex: number
}

const CHORDS: Chord[] = [
  { name: 'C', label: 'Happy', glow: '#ff1b7a', notes: [60, 64, 67, 72] },
  { name: 'G', label: 'Bright', glow: '#2f3aa8', notes: [55, 59, 62, 67] },
  { name: 'Am', label: 'Dreamy', glow: '#f2ff5a', notes: [57, 60, 64, 69] },
  { name: 'F', label: 'Warm', glow: '#7fb4ff', notes: [53, 57, 60, 65] },
  { name: 'Dm', label: 'Soft', glow: '#ff7ae2', notes: [50, 53, 57, 62] },
  { name: 'Em', label: 'Cool', glow: '#54f3ff', notes: [52, 55, 59, 64] },
  { name: 'G/B', label: 'Lift', glow: '#ffa642', notes: [59, 62, 67, 71] },
  { name: 'C/E', label: 'Glow', glow: '#7cff4e', notes: [52, 55, 60, 64] }
]

const createAudioStore = (): AudioStore => ({
  audioCtx: null,
  masterGain: null,
  masterBus: null,
  saturator: null,
  compressor: null,
  delaySend: null,
  delayNode: null,
  delayFeedback: null,
  delayFilter: null,
  noiseBuffer: null,
  currentChordVoice: null,
  currentChordName: null,
  beatRunning: false,
  schedulerTimer: null,
  nextStepTime: 0,
  stepIndex: 0
})

function App() {
  const [bpm, setBpm] = useState(120)
  const [groove, setGroove] = useState(60)
  const [density, setDensity] = useState(25)
  const [magic, setMagic] = useState(10)
  const [activeChord, setActiveChord] = useState<string | null>(null)
  const audioRef = useRef<AudioStore>(createAudioStore())

  const chordMap = useMemo(() => {
    const map: Record<string, number[]> = {}
    CHORDS.forEach((chord) => {
      map[chord.name] = chord.notes
    })
    return map
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--beat', `${60 / bpm}s`)
  }, [bpm])

  useEffect(() => {
    document.documentElement.style.setProperty('--magic', (magic / 100).toFixed(2))
  }, [magic])

  function ensureAudio() {
    const store = audioRef.current
    if (!store.audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      store.audioCtx = new AudioContextClass()
      setupAudioChain(store)
    }
    if (store.audioCtx.state === 'suspended') {
      store.audioCtx.resume()
    }
  }

  function setupAudioChain(store: AudioStore) {
    const audioCtx = store.audioCtx
    if (!audioCtx) return
    store.masterBus = audioCtx.createGain()
    store.masterBus.gain.value = 1

    store.masterGain = audioCtx.createGain()
    store.masterGain.gain.value = 0.65

    store.saturator = audioCtx.createWaveShaper()
    store.saturator.curve = makeSaturationCurve(0.2)
    store.saturator.oversample = '2x'

    store.compressor = audioCtx.createDynamicsCompressor()
    store.compressor.threshold.value = -18
    store.compressor.knee.value = 20
    store.compressor.ratio.value = 2.2
    store.compressor.attack.value = 0.008
    store.compressor.release.value = 0.12

    store.delaySend = audioCtx.createGain()
    store.delaySend.gain.value = 0.08
    store.delayNode = audioCtx.createDelay(0.6)
    store.delayNode.delayTime.value = 0.25
    store.delayFeedback = audioCtx.createGain()
    store.delayFeedback.gain.value = 0.25
    store.delayFilter = audioCtx.createBiquadFilter()
    store.delayFilter.type = 'lowpass'
    store.delayFilter.frequency.value = 2600

    store.masterBus.connect(store.saturator)
    store.saturator.connect(store.compressor)
    store.compressor.connect(store.masterGain)
    store.masterGain.connect(audioCtx.destination)

    store.masterBus.connect(store.delaySend)
    store.delaySend.connect(store.delayNode)
    store.delayNode.connect(store.delayFilter)
    store.delayFilter.connect(store.compressor)
    store.delayNode.connect(store.delayFeedback)
    store.delayFeedback.connect(store.delayNode)

    store.noiseBuffer = createNoiseBuffer(audioCtx)
  }

  function makeSaturationCurve(amount: number) {
    const samples = 44100
    const curve = new Float32Array(samples)
    const k = amount * 40
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / samples - 1
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
    }
    return curve
  }

  function createNoiseBuffer(audioCtx: AudioContext) {
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 1, audioCtx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1
    }
    return buffer
  }

  function midiToFreq(midi: number) {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  function updateMagic(nextMagic: number) {
    const store = audioRef.current
    const drive = 0.15 + nextMagic * 0.5
    if (store.saturator) store.saturator.curve = makeSaturationCurve(drive)
    if (store.delaySend) store.delaySend.gain.value = 0.05 + nextMagic * 0.08
  }

  function createNoiseBurst(time: number, duration: number, gainValue: number, freq: number) {
    const store = audioRef.current
    if (!store.audioCtx || !store.noiseBuffer || !store.masterBus) return
    const noise = store.audioCtx.createBufferSource()
    noise.buffer = store.noiseBuffer
    const filter = store.audioCtx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    const gain = store.audioCtx.createGain()
    gain.gain.setValueAtTime(gainValue, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(store.masterBus)
    noise.start(time)
    noise.stop(time + duration + 0.02)
  }

  function createChordVoice(chordName: string) {
    const store = audioRef.current
    const audioCtx = store.audioCtx
    if (!audioCtx || !store.masterBus) return null
    const now = audioCtx.currentTime
    const notes = chordMap[chordName] || chordMap.C
    const voiceGain = audioCtx.createGain()
    voiceGain.gain.setValueAtTime(0.0001, now)
    voiceGain.gain.linearRampToValueAtTime(0.5, now + 0.04)

    const filter = audioCtx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1400, now)
    filter.frequency.linearRampToValueAtTime(2200, now + 1.5)

    const lfo = audioCtx.createOscillator()
    const lfoGain = audioCtx.createGain()
    lfo.frequency.value = 0.35 + (magic / 100) * 0.6
    lfoGain.gain.value = 60 + (magic / 100) * 120
    lfo.connect(lfoGain)
    lfoGain.connect(filter.frequency)

    const shimmerGain = audioCtx.createGain()
    shimmerGain.gain.setValueAtTime(0.0001, now + 1.5)
    shimmerGain.gain.linearRampToValueAtTime(0.12 + (magic / 100) * 0.18, now + 3)

    const nodes = notes.map((midi, i) => {
      const osc = audioCtx.createOscillator()
      const osc2 = audioCtx.createOscillator()
      const pan = audioCtx.createStereoPanner()
      const detune = (i % 2 === 0 ? -6 : 6) * (1 + (magic / 100) * 0.5)
      osc.type = 'triangle'
      osc.frequency.value = midiToFreq(midi)
      osc.detune.value = detune
      osc2.type = 'sawtooth'
      osc2.frequency.value = midiToFreq(midi)
      osc2.detune.value = detune * 0.4
      pan.pan.value = (i - 1.5) * 0.2
      osc.connect(pan)
      osc2.connect(pan)
      pan.connect(filter)
      osc.start(now + i * 0.012)
      osc2.start(now + i * 0.012)
      return { osc, osc2 }
    })

    const shimmerOsc = audioCtx.createOscillator()
    shimmerOsc.type = 'triangle'
    shimmerOsc.frequency.value = midiToFreq(notes[0] + 12)
    shimmerOsc.connect(shimmerGain)
    shimmerGain.connect(filter)
    shimmerOsc.start(now + 1.5)

    filter.connect(voiceGain)
    voiceGain.connect(store.masterBus)

    createNoiseBurst(now, 0.06, 0.2, 2200)
    lfo.start(now + 1.5)

    return {
      stop(release = 0.16) {
        const t = audioCtx.currentTime
        voiceGain.gain.cancelScheduledValues(t)
        voiceGain.gain.setValueAtTime(Math.max(voiceGain.gain.value, 0.0001), t)
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, t + release)
        nodes.forEach(({ osc, osc2 }) => {
          osc.stop(t + release + 0.05)
          osc2.stop(t + release + 0.05)
        })
        shimmerOsc.stop(t + release + 0.05)
        lfo.stop(t + release + 0.05)
      }
    }
  }

  function playKick(time: number) {
    const store = audioRef.current
    if (!store.audioCtx || !store.masterBus) return
    const osc = store.audioCtx.createOscillator()
    const gain = store.audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, time)
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12)
    gain.gain.setValueAtTime(0.9, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
    osc.connect(gain)
    gain.connect(store.masterBus)
    osc.start(time)
    osc.stop(time + 0.18)
    createNoiseBurst(time, 0.02, 0.12, 1800)
  }

  function playSnare(time: number) {
    const store = audioRef.current
    if (!store.audioCtx || !store.masterBus) return
    const osc = store.audioCtx.createOscillator()
    const gain = store.audioCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(190, time)
    gain.gain.setValueAtTime(0.2, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18)
    osc.connect(gain)
    gain.connect(store.masterBus)
    osc.start(time)
    osc.stop(time + 0.2)
    ;[0, 0.015, 0.03].forEach((offset, i) => {
      createNoiseBurst(time + offset, 0.12, 0.22 - i * 0.04, 1800)
    })
  }

  function playHat(time: number, length: number) {
    const store = audioRef.current
    if (!store.audioCtx || !store.noiseBuffer || !store.masterBus) return
    const noise = store.audioCtx.createBufferSource()
    noise.buffer = store.noiseBuffer
    const filter = store.audioCtx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 5200
    const gain = store.audioCtx.createGain()
    gain.gain.setValueAtTime(0.08 + (density / 100) * 0.08, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(store.masterBus)
    noise.start(time)
    noise.stop(time + length + 0.02)
  }

  function scheduleBeat() {
    const store = audioRef.current
    if (!store.audioCtx) return
    const scheduleAhead = 0.15
    const stepDur = (60 / bpm) / 4
    const swingAmount = 0.5 + (groove / 100) * 0.12

    while (store.nextStepTime < store.audioCtx.currentTime + scheduleAhead) {
      const step = store.stepIndex % 16
      const beat = step % 4
      const time = store.nextStepTime

      const kickOn1 = density / 100 > 0.25
      if (step === 0 || (kickOn1 && step === 8)) {
        playKick(time)
      }
      if (step === 4 || step === 12) {
        playSnare(time)
      }
      const swingOffset = step % 2 === 1 ? (swingAmount - 0.5) * stepDur : 0
      if (step % 2 === 0 || density / 100 > 0.35) {
        const hatLen = density / 100 > 0.6 ? 0.14 : 0.08
        playHat(time + swingOffset, hatLen)
      }
      if (density / 100 > 0.7 && beat === 3) {
        playHat(time + swingOffset + stepDur * 0.5, 0.05)
      }
      if (density / 100 > 0.8 && step === 14) {
        playSnare(time + 0.01)
      }

      store.nextStepTime += stepDur
      store.stepIndex += 1
    }

    store.schedulerTimer = window.setTimeout(scheduleBeat, 25)
  }

  function startBeat() {
    const store = audioRef.current
    if (store.beatRunning || !store.audioCtx) return
    store.beatRunning = true
    store.nextStepTime = store.audioCtx.currentTime + 0.05
    store.stepIndex = 0
    scheduleBeat()
  }

  function stopBeat() {
    const store = audioRef.current
    store.beatRunning = false
    if (store.schedulerTimer) window.clearTimeout(store.schedulerTimer)
    store.schedulerTimer = null
  }

  function stopAll() {
    stopBeat()
    const store = audioRef.current
    if (store.currentChordVoice) {
      store.currentChordVoice.stop(0.08)
      store.currentChordVoice = null
    }
    store.currentChordName = null
    setActiveChord(null)
  }

  function handleChordDown(chord: Chord, event: React.PointerEvent<HTMLButtonElement>) {
    ensureAudio()
    event.currentTarget.setPointerCapture(event.pointerId)
    const store = audioRef.current
    if (store.currentChordName !== chord.name) {
      if (store.currentChordVoice) {
        store.currentChordVoice.stop(0.14)
      }
      store.currentChordVoice = createChordVoice(chord.name)
      store.currentChordName = chord.name
      setActiveChord(chord.name)
      emitVisual({ type: 'CHORD_CHANGE', chordName: chord.name })
    }
    const velocity = Math.max(0.2, event.pressure || 0.7)
    emitVisual({ type: 'NOTE_ON', note: chord.notes[0], velocity, chordId: chord.name })
    startBeat()
  }

  function handleChordUp(chord: Chord) {
    const store = audioRef.current
    if (store.currentChordVoice) store.currentChordVoice.stop(0.16)
    store.currentChordVoice = null
    store.currentChordName = null
    setActiveChord(null)
    emitVisual({ type: 'NOTE_OFF', note: chord.notes[0] })
  }

  function handleUnlock() {
    ensureAudio()
    startBeat()
  }

  function handlePanic() {
    stopAll()
    emitVisual({ type: 'PANIC' })
  }

  useEffect(() => {
    updateMagic(magic / 100)
    emitVisual({ type: 'MAGIC_CHANGE', amount: magic / 100 })
  }, [magic])

  useEffect(() => {
    emitVisual({ type: 'TEMPO_CHANGE', bpm })
  }, [bpm])

  useEffect(() => {
    emitVisual({ type: 'GROOVE_CHANGE', amount: groove / 100 })
  }, [groove])

  useEffect(() => {
    emitVisual({ type: 'DENSITY_CHANGE', amount: density / 100 })
  }, [density])

  useEffect(() => {
    const handleBlur = () => stopAll()
    const handleVisibility = () => {
      if (document.hidden) stopAll()
    }
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const grooveLabel = groove < 40 ? 'Straight' : groove < 70 ? 'Bouncy' : 'Wiggly'
  const densityLabel = density < 40 ? 'Simple' : density < 70 ? 'Fun' : 'Busy'
  const magicLabel = magic < 30 ? 'Clean' : magic < 70 ? 'Sparkly' : 'Alien'
  const densityLevel = density < 25 ? '1' : density < 50 ? '2' : density < 75 ? '3' : '4'

  return (
    <>
      <ParticleSea />
      <div className="app-shell relative z-10 min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(54,64,120,0.55),_rgba(5,6,10,0.95)_55%),_linear-gradient(120deg,_rgba(8,15,28,0.9),_rgba(2,2,6,1))] px-5 py-6 text-ink">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div className="text-lg font-semibold uppercase tracking-[0.2em]">
            Pop Parts for Kids
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleUnlock}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink shadow-[0_0_16px_rgba(0,229,255,0.3)] transition hover:border-cyan-300 hover:shadow-[0_0_18px_rgba(0,229,255,0.45)]"
            >
              Unlock Audio
            </button>
            <button
              onClick={handlePanic}
              className="rounded-full border border-pink-400/40 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink shadow-[0_0_12px_rgba(255,45,255,0.35)] transition hover:border-pink-300"
            >
              Panic
            </button>
          </div>
        </div>

        <div className="mx-auto mt-6 grid max-w-5xl items-center gap-6 lg:grid-cols-[minmax(280px,1fr)_minmax(260px,320px)]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CHORDS.map((chord) => (
              <button
                key={chord.name}
                className={`chord-btn flex h-[120px] flex-col items-center justify-center gap-2 text-2xl font-bold uppercase tracking-[0.08em] text-ink ${
                  activeChord === chord.name ? 'active' : ''
                }`}
                style={{ '--glow': chord.glow } as React.CSSProperties}
                onPointerDown={(event) => handleChordDown(chord, event)}
                onPointerUp={() => handleChordUp(chord)}
                onPointerCancel={() => handleChordUp(chord)}
                onPointerLeave={() => handleChordUp(chord)}
              >
                <span className="relative z-10">{chord.name}</span>
                <span className="relative z-10 text-xs uppercase tracking-[0.2em] text-muted">
                  {chord.label}
                </span>
                <span className="pulse-ring"></span>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <div className="text-xs uppercase tracking-[0.2em] text-muted">
              Hold a chord to hear it evolve.
            </div>

            <div className="mt-5 space-y-4">
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                  <span>Tempo</span>
                  <span className="text-sm tabular-nums">{bpm}</span>
                </div>
                <input
                  type="range"
                  min="80"
                  max="160"
                  value={bpm}
                  onChange={(event) => setBpm(Number(event.target.value))}
                  className="w-full accent-cyan-300"
                />
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="tempo-dot"></span>
                  <span>Speed</span>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                  <span>Groove</span>
                  <span className="text-sm tabular-nums">{grooveLabel}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={groove}
                  onChange={(event) => setGroove(Number(event.target.value))}
                  className="w-full accent-fuchsia-400"
                />
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="groove-wobble"></span>
                  <span>Feel</span>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                  <span>Density</span>
                  <span className="text-sm tabular-nums">{densityLabel}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={density}
                  onChange={(event) => setDensity(Number(event.target.value))}
                  className="w-full accent-lime-300"
                />
                <div className="density-dots text-xs text-muted" data-level={densityLevel}>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                  <span>Magic</span>
                  <span className="text-sm tabular-nums">{magicLabel}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={magic}
                  onChange={(event) => setMagic(Number(event.target.value))}
                  className="w-full accent-amber-300"
                />
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="magic-shimmer"></span>
                  <span>Sparkle</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default App
