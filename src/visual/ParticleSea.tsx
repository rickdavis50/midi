import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { chordToColor, mixColors, noteToColor } from './palette'
import { FpsMonitor } from './perf'
import { subscribeVisual } from './visualBus'

const IMPACT_LIMIT = 8

type Impact = {
  x: number
  z: number
  start: number
  strength: number
  radius: number
  speed: number
  decay: number
  hueShift: number
}

type QualityState = {
  activeCount: number
  dprMax: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const isMobile = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

const shuffleIndices = (count: number) => {
  const indices = Array.from({ length: count }, (_, i) => i)
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices
}

const buildImpactUniforms = () => {
  const data = []
  const params = []
  for (let i = 0; i < IMPACT_LIMIT; i += 1) {
    data.push(new THREE.Vector4(0, 0, -9999, 0))
    params.push(new THREE.Vector4(1, 1, 1, 0))
  }
  return { data, params }
}

const createShader = () => {
  return {
    vertexShader: `
      uniform float uTime;
      uniform float uWaveAmp;
      uniform float uWaveSpeed;
      uniform float uGroove;
      uniform float uSparkle;
      uniform float uDepth;
      uniform vec4 uImpactData[${IMPACT_LIMIT}];
      uniform vec4 uImpactParams[${IMPACT_LIMIT}];
      attribute float aSeed;
      varying float vIntensity;
      varying vec3 vColorMix;
      varying vec2 vScreen;
      varying float vDepthFade;

      float waveField(vec2 pos, float time) {
        float wave1 = sin(pos.x * 0.12 + time * 0.6);
        float wave2 = cos(pos.y * 0.15 - time * 0.45);
        float wave3 = sin((pos.x + pos.y) * 0.08 + time * 0.3);
        return (wave1 + wave2 + wave3) * 0.35;
      }

      void main() {
        vec3 base = position;
        float time = uTime * uWaveSpeed;
        float baseWave = waveField(base.xz, time);
        float ripple = 0.0;
        float glowBoost = 0.0;

        for (int i = 0; i < ${IMPACT_LIMIT}; i++) {
          vec4 impact = uImpactData[i];
          vec4 params = uImpactParams[i];
          float age = uTime - impact.z;
          if (age > 0.0) {
            float dist = distance(base.xz, impact.xy);
            float wave = sin(dist * params.y - age * params.y * 2.0);
            float falloff = exp(-dist * dist / (params.x * params.x));
            float decay = exp(-age * params.z);
            ripple += wave * impact.w * falloff * decay;
            glowBoost += falloff * impact.w * 0.35;
          }
        }

        float grooveNoise = sin(base.x * 0.24 + uTime * 1.2 + aSeed * 6.0) * 0.15;
        float height = (baseWave + ripple) * uWaveAmp + grooveNoise * uGroove;

        vec3 displaced = vec3(base.x, height, base.z);
        vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
        vec4 clip = projectionMatrix * mvPosition;
        vScreen = clip.xy / clip.w;
        vDepthFade = smoothstep(-uDepth * 0.5, uDepth * 0.5, base.z);

        float sparkle = smoothstep(0.9 - uSparkle * 0.35, 1.0, fract(sin(aSeed * 91.7 + uTime * 3.2) * 43758.5453));
        vIntensity = clamp(0.4 + height * 0.4 + glowBoost + sparkle * 0.5, 0.0, 1.5);
        vColorMix = vec3(0.6 + baseWave * 0.2, 0.7, 1.0);

        gl_PointSize = (2.0 + aSeed * 2.5 + vIntensity * 6.0) * (220.0 / -mvPosition.z);
        gl_Position = clip;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uVignette;
      varying float vIntensity;
      varying vec3 vColorMix;
      varying vec2 vScreen;
      varying float vDepthFade;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        float core = smoothstep(0.5, 0.0, dist);
        float halo = smoothstep(0.7, 0.0, dist);
        float glow = core + halo * 0.6;

        vec2 screenUv = vScreen * 0.5 + 0.5;
        float vignette = smoothstep(0.85, 0.25, distance(screenUv, vec2(0.5)));
        float topFade = smoothstep(0.0, 0.6, 1.0 - screenUv.y);

        vec3 baseColor = mix(uColorA, uColorB, vColorMix.x);
        vec3 color = baseColor * vIntensity;
        color *= glow;
        color *= mix(1.0, vignette, uVignette);
        color *= topFade * (0.65 + vDepthFade * 0.35);

        float alpha = glow * 0.9;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `
  }
}

type ParticleSeaProps = {
  className?: string
}

export default function ParticleSea({ className }: ParticleSeaProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const qualityRef = useRef<QualityState>({ activeCount: 0, dprMax: 1.5 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const maxTarget = isMobile() ? 12000 : 30000
    const gridSize = Math.floor(Math.sqrt(maxTarget))
    const maxCount = gridSize * gridSize
    const baseWidth = 70
    const baseDepth = 70
    const depth = baseDepth
    const width = baseWidth * (window.innerWidth / window.innerHeight)
    const { data: impactData, params: impactParams } = buildImpactUniforms()

    const positions = new Float32Array(maxCount * 3)
    const seeds = new Float32Array(maxCount)
    const indices = shuffleIndices(maxCount)

    for (let z = 0; z < gridSize; z += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const baseIndex = x + z * gridSize
        const i = indices[baseIndex]
        const px = (x / (gridSize - 1) - 0.5) * width
        const pz = (z / (gridSize - 1) - 0.5) * depth
        positions[i * 3] = px
        positions[i * 3 + 1] = 0
        positions[i * 3 + 2] = pz
        seeds[i] = Math.random()
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

    const shader = createShader()
    const uniforms = {
      uTime: { value: 0 },
      uWaveAmp: { value: 1.8 },
      uWaveSpeed: { value: 0.55 },
      uGroove: { value: 0.15 },
      uSparkle: { value: 0.2 },
      uDepth: { value: depth },
      uColorA: { value: new THREE.Color(0.2, 0.6, 1) },
      uColorB: { value: new THREE.Color(0.9, 0.4, 0.9) },
      uVignette: { value: 0.7 },
      uImpactData: { value: impactData },
      uImpactParams: { value: impactParams }
    }

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })

    const points = new THREE.Points(geometry, material)

    const scene = new THREE.Scene()
    scene.add(points)

    const camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    )
    camera.position.set(0, 18, 36)
    camera.lookAt(0, 0, -8)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityRef.current.dprMax))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x05060a, 0)
    container.appendChild(renderer.domElement)

    const impacts: Impact[] = []
    let activeCount = Math.floor(maxCount * 0.75)
    geometry.setDrawRange(0, activeCount)
    qualityRef.current.activeCount = activeCount

    let paletteA = new THREE.Color(0.2, 0.6, 1)
    let paletteB = new THREE.Color(0.9, 0.4, 0.9)
    let targetPalette = paletteB.clone()
    let paletteBlend = 0
    let lastTime = performance.now()
    let lastRain = 0
    const perf = new FpsMonitor()

    const applyQuality = (action: 'decrease' | 'increase' | 'hold') => {
      if (action === 'decrease') {
        activeCount = Math.max(Math.floor(activeCount * 0.75), Math.floor(maxCount * 0.35))
        geometry.setDrawRange(0, activeCount)
        qualityRef.current.activeCount = activeCount
        qualityRef.current.dprMax = Math.max(1, qualityRef.current.dprMax - 0.25)
        renderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, qualityRef.current.dprMax)
        )
      }
      if (action === 'increase') {
        activeCount = Math.min(Math.floor(activeCount * 1.1), maxCount)
        geometry.setDrawRange(0, activeCount)
        qualityRef.current.activeCount = activeCount
        qualityRef.current.dprMax = Math.min(1.6, qualityRef.current.dprMax + 0.1)
        renderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, qualityRef.current.dprMax)
        )
      }
    }

    const addImpact = (x: number, z: number, strength: number, radius: number, hueShift = 0) => {
      impacts.unshift({
        x,
        z,
        start: performance.now() / 1000,
        strength,
        radius,
        speed: 2.5,
        decay: 0.8,
        hueShift
      })
      if (impacts.length > IMPACT_LIMIT) impacts.pop()
    }

    const updateImpactUniforms = () => {
      for (let i = 0; i < IMPACT_LIMIT; i += 1) {
        const impact = impacts[i]
        if (!impact) {
          impactData[i].set(0, 0, -9999, 0)
          impactParams[i].set(1, 1, 1, 0)
          continue
        }
        impactData[i].set(impact.x, impact.z, impact.start, impact.strength)
        impactParams[i].set(impact.radius, impact.speed, impact.decay, impact.hueShift)
      }
    }

    const mapNoteToSurface = (note: number) => {
      const angle = ((note % 12) / 12) * Math.PI * 2
      const band = Math.floor(note / 12) % 3
      const radius = (0.2 + band * 0.18) * width
      return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius * 0.6 - depth * 0.15
      }
    }

    const unsubscribe = subscribeVisual((event) => {
      if (event.type === 'NOTE_ON') {
        const point = mapNoteToSurface(event.note)
        const strength = clamp(event.velocity, 0.2, 1) * 1.6
        addImpact(point.x, point.z, strength, 10 + strength * 4, event.note * 0.02)
        const color = noteToColor(event.note)
        targetPalette = new THREE.Color(color[0], color[1], color[2])
        paletteBlend = 0
      }
      if (event.type === 'NOTE_OFF') {
        const point = mapNoteToSurface(event.note)
        addImpact(point.x, point.z, 0.6, 6)
      }
      if (event.type === 'CHORD_CHANGE') {
        const color = chordToColor(event.chordName)
        targetPalette = new THREE.Color(color[0], color[1], color[2])
        paletteBlend = 0
        uniforms.uWaveAmp.value = 2.2
      }
      if (event.type === 'TEMPO_CHANGE') {
        uniforms.uWaveSpeed.value = clamp(event.bpm / 140, 0.35, 1.2)
      }
      if (event.type === 'GROOVE_CHANGE') {
        uniforms.uGroove.value = clamp(event.amount * 0.6, 0.05, 0.6)
      }
      if (event.type === 'DENSITY_CHANGE') {
        const targetCount = Math.floor(maxCount * (0.35 + event.amount * 0.65))
        activeCount = clamp(targetCount, Math.floor(maxCount * 0.3), maxCount)
        geometry.setDrawRange(0, activeCount)
        qualityRef.current.activeCount = activeCount
      }
      if (event.type === 'MAGIC_CHANGE') {
        uniforms.uSparkle.value = clamp(event.amount * 0.8, 0.1, 0.95)
      }
      if (event.type === 'PANIC') {
        addImpact(0, 0, 2.2, 18)
        paletteA = new THREE.Color(0.2, 0.6, 1)
        targetPalette = new THREE.Color(0.9, 0.4, 0.9)
        paletteBlend = 0
        uniforms.uWaveAmp.value = 1.6
      }
    })

    let animationFrame: number | null = null
    const animate = (now: number) => {
      const delta = (now - lastTime) / 1000
      lastTime = now
      const time = now / 1000
      uniforms.uTime.value = time
      perf.tick(now)
      applyQuality(perf.getAction())

      updateImpactUniforms()

      if (paletteBlend < 1) {
        paletteBlend = clamp(paletteBlend + delta * 0.6, 0, 1)
        const mix = mixColors(
          [paletteA.r, paletteA.g, paletteA.b],
          [targetPalette.r, targetPalette.g, targetPalette.b],
          paletteBlend
        )
        uniforms.uColorA.value.set(mix[0], mix[1], mix[2])
        uniforms.uColorB.value.set(mix[0] * 1.2, mix[1] * 0.7 + 0.1, mix[2] * 1.1)
        if (paletteBlend >= 1) {
          paletteA = targetPalette.clone()
        }
      }

      if (uniforms.uWaveAmp.value > 1.8) {
        uniforms.uWaveAmp.value = Math.max(1.8, uniforms.uWaveAmp.value - delta * 0.4)
      }

      const raininess = uniforms.uGroove.value + uniforms.uSparkle.value
      if (raininess > 0.9 && now - lastRain > 320) {
        lastRain = now
        const rx = (Math.random() - 0.5) * width
        const rz = (Math.random() - 0.5) * depth
        addImpact(rx, rz, 0.5, 5)
      }

      renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container
      const aspect = clientWidth / clientHeight
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityRef.current.dprMax))
      renderer.setSize(clientWidth, clientHeight)
    })
    resizeObserver.observe(container)

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      if (animationFrame) cancelAnimationFrame(animationFrame)
      renderer.dispose()
      material.dispose()
      geometry.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={
        className ?? 'fixed inset-0 -z-10 h-full w-full pointer-events-none'
      }
    />
  )
}
