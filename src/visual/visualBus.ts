export type VisualEvent =
  | { type: 'NOTE_ON'; note: number; velocity: number; channel?: number; chordId?: string }
  | { type: 'NOTE_OFF'; note: number; velocity?: number }
  | { type: 'CHORD_CHANGE'; chordName: string }
  | { type: 'TEMPO_CHANGE'; bpm: number }
  | { type: 'GROOVE_CHANGE'; amount: number }
  | { type: 'DENSITY_CHANGE'; amount: number }
  | { type: 'MAGIC_CHANGE'; amount: number }
  | { type: 'PANIC' }

type VisualHandler = (event: VisualEvent) => void

const subscribers = new Set<VisualHandler>()

export const emitVisual = (event: VisualEvent) => {
  subscribers.forEach((handler) => handler(event))
}

export const subscribeVisual = (handler: VisualHandler) => {
  subscribers.add(handler)
  return () => {
    subscribers.delete(handler)
  }
}
