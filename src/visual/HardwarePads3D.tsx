import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { createNoiseTexture } from './noiseTexture'
import { chordToColor, mixColors } from './palette'
import { subscribeVisual } from './visualBus'

type PadMesh = {
  id: string
  element: HTMLElement
  baseColor: THREE.Color
  intensity: number
  target: number
  mesh: THREE.Mesh
  halo: THREE.Mesh
}

type LayoutRects = {
  container: DOMRect
  pads: DOMRect[]
}

const PAD_COLORS = ['C', 'G', 'Am', 'F', 'Dm', 'Em', 'G/B', 'C/E']

const createRoundedRectShape = (width: number, height: number, radius: number) => {
  const shape = new THREE.Shape()
  const x = -width / 2
  const y = -height / 2
  const r = Math.min(radius, width / 2, height / 2)
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return shape
}

const padVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const padFragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSoftness;

  float roundedRectSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float radius = 0.35;
    float sdf = roundedRectSDF(uv, vec2(0.78), radius);
    float edge = smoothstep(0.02 + uSoftness, -0.02, sdf);
    float inner = smoothstep(-0.08, -0.45, sdf);
    float rim = smoothstep(0.22, 0.0, abs(sdf));

    vec2 lightDir = normalize(vec2(-0.4, 0.8));
    float light = clamp(dot(normalize(uv + 0.0001), lightDir) * 0.5 + 0.6, 0.0, 1.0);
    float centerGlow = exp(-dot(uv, uv) * 3.5);
    float hotspot = exp(-dot(uv + vec2(0.15, 0.25), uv + vec2(0.15, 0.25)) * 8.0);

    float base = mix(0.08, 0.2, inner);
    float glow = centerGlow * (0.3 + uIntensity * 0.9);
    float highlight = (0.2 + light * 0.6) * (0.35 + uIntensity * 0.5);
    float edgeDark = 1.0 - rim * 0.4;

    vec3 color = uColor * (base + glow + highlight);
    color *= edgeDark;
    color += uColor * hotspot * (0.25 + uIntensity * 0.4);
    float alpha = edge;
    gl_FragColor = vec4(color, alpha);
  }
`

const haloFragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uIntensity;

  float roundedRectSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float sdf = roundedRectSDF(uv, vec2(0.9), 0.4);
    float glow = smoothstep(0.5, -0.4, sdf);
    float center = exp(-dot(uv, uv) * 2.0);
    float alpha = glow * (0.2 + uIntensity * 0.65) * center;
    vec3 color = uColor * (0.6 + uIntensity * 0.8);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`

export default function HardwarePads3D() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const padMeshesRef = useRef<PadMesh[]>([])
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const chassisRef = useRef<THREE.Mesh | null>(null)
  const layoutRef = useRef<LayoutRects | null>(null)
  const rafRef = useRef<number | null>(null)

  const padMaterials = useMemo(() => {
    const base = new THREE.ShaderMaterial({
      vertexShader: padVertexShader,
      fragmentShader: padFragmentShader,
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color('#222') },
        uIntensity: { value: 0 },
        uSoftness: { value: 0.0 }
      }
    })
    const halo = new THREE.ShaderMaterial({
      vertexShader: padVertexShader,
      fragmentShader: haloFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color('#fff') },
        uIntensity: { value: 0 }
      }
    })
    return { base, halo }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const padElements = Array.from(document.querySelectorAll<HTMLElement>('.chord-btn'))
    if (!padElements.length) return undefined
    const padContainer = padElements[0].parentElement
    if (!padContainer) return undefined

    const appShell = document.querySelector<HTMLElement>('.app-shell')
    if (!appShell) return undefined

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, /Mobi|Android/i.test(navigator.userAgent) ? 1 : 1.5)
    )

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -200, 200)
    camera.position.set(0, 0, 40)

    const ambient = new THREE.AmbientLight(0xffffff, 0.28)
    const key = new THREE.DirectionalLight(0xffffff, 0.9)
    key.position.set(-0.4, 0.8, 1)
    const fill = new THREE.DirectionalLight(0x9cc7ff, 0.4)
    fill.position.set(0.6, 0.4, 0.6)
    const rim = new THREE.DirectionalLight(0xffffff, 0.3)
    rim.position.set(0, -0.6, 0.8)
    scene.add(ambient, key, fill, rim)

    const noise = createNoiseTexture(96)
    const chassisMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#15161b'),
      metalness: 0.15,
      roughness: 0.85,
      clearcoat: 0.15,
      clearcoatRoughness: 0.9,
      roughnessMap: noise
    })

    const chassis = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>(
      new THREE.PlaneGeometry(1, 1),
      chassisMaterial
    )
    chassis.position.set(0, 0, -5)
    scene.add(chassis)

    const padGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)
    const haloGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)

    const pads: PadMesh[] = padElements.map((element, index) => {
      const chordName = element.textContent?.trim().split(/\s+/)[0] || PAD_COLORS[index] || 'C'
      const base = chordToColor(chordName)
      const baseColor = new THREE.Color(base[0], base[1], base[2])
      const baseMaterial = padMaterials.base.clone()
      baseMaterial.uniforms.uColor.value = baseColor.clone()
      baseMaterial.uniforms.uSoftness.value = 0.02
      const haloMaterial = padMaterials.halo.clone()
      haloMaterial.uniforms.uColor.value = baseColor.clone()
      const mesh = new THREE.Mesh(padGeometry, baseMaterial)
      const halo = new THREE.Mesh(haloGeometry, haloMaterial)
      halo.position.z = -1
      scene.add(mesh, halo)
      return {
        id: chordName,
        element,
        baseColor,
        intensity: 0,
        target: 0,
        mesh,
        halo
      }
    })
    padMeshesRef.current = pads

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    chassisRef.current = chassis
    container.appendChild(renderer.domElement)

    const updateLayout = () => {
      const containerRect = padContainer.getBoundingClientRect()
      const shellRect = appShell.getBoundingClientRect()
      const padsRects = padElements.map((pad) => pad.getBoundingClientRect())
      layoutRef.current = { container: containerRect, pads: padsRects }
      const width = containerRect.width
      const height = containerRect.height
      container.style.left = `${containerRect.left - shellRect.left}px`
      container.style.top = `${containerRect.top - shellRect.top}px`
      container.style.width = `${width}px`
      container.style.height = `${height}px`
      renderer.setSize(width, height)
      camera.left = 0
      camera.right = width
      camera.top = height
      camera.bottom = 0
      camera.updateProjectionMatrix()

      const padBounds = padsRects.reduce(
        (acc, rect) => {
          const left = rect.left - containerRect.left
          const top = rect.top - containerRect.top
          const right = left + rect.width
          const bottom = top + rect.height
          return {
            minX: Math.min(acc.minX, left),
            minY: Math.min(acc.minY, top),
            maxX: Math.max(acc.maxX, right),
            maxY: Math.max(acc.maxY, bottom)
          }
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      )

      const platePadding = 26
      const plateWidth = padBounds.maxX - padBounds.minX + platePadding * 2
      const plateHeight = padBounds.maxY - padBounds.minY + platePadding * 2
      const plateX = padBounds.minX - platePadding + plateWidth / 2
      const plateY = padBounds.minY - platePadding + plateHeight / 2
      const shape = createRoundedRectShape(plateWidth, plateHeight, 22)
      chassis.geometry.dispose()
      chassis.geometry = new THREE.ShapeGeometry(shape)
      chassis.position.set(plateX, height - plateY, -6)

      pads.forEach((pad, idx) => {
        const rect = padsRects[idx]
        const x = rect.left - containerRect.left + rect.width / 2
        const y = rect.top - containerRect.top + rect.height / 2
        pad.mesh.position.set(x, height - y, 0)
        pad.halo.position.set(x, height - y, -2)
        pad.mesh.scale.set(rect.width, rect.height, 1)
        pad.halo.scale.set(rect.width * 1.18, rect.height * 1.18, 1)
      })
    }

    updateLayout()

    const resizeObserver = new ResizeObserver(() => {
      updateLayout()
    })
    resizeObserver.observe(padContainer)
    window.addEventListener('scroll', updateLayout, { passive: true })
    window.addEventListener('resize', updateLayout)

    const unsubscribe = subscribeVisual((event) => {
      const pads = padMeshesRef.current
      if (!pads.length) return
      if (event.type === 'NOTE_ON') {
        const targetPad = event.chordId
          ? pads.find((pad) => pad.id === event.chordId)
          : pads.find((pad) => pad.id === PAD_COLORS[event.note % pads.length])
        if (targetPad) {
          targetPad.target = Math.max(targetPad.target, 1)
          const base = chordToColor(targetPad.id)
          const boosted = mixColors(base, [1, 1, 1], 0.35)
          targetPad.baseColor.setRGB(boosted[0], boosted[1], boosted[2])
        }
      }
      if (event.type === 'NOTE_OFF') {
        const targetPad = event.chordId
          ? pads.find((pad) => pad.id === event.chordId)
          : pads.find((pad) => pad.id === PAD_COLORS[event.note % pads.length])
        if (targetPad) {
          targetPad.target = 0
          const base = chordToColor(targetPad.id)
          targetPad.baseColor.setRGB(base[0], base[1], base[2])
        }
      }
    })

    const animate = () => {
      const pads = padMeshesRef.current
      pads.forEach((pad) => {
        pad.intensity += (pad.target - pad.intensity) * 0.12
        if (pad.target > 0.1 && pad.intensity < 0.6) {
          pad.intensity += 0.04
        }
        if (pad.target <= 0.01) {
          pad.intensity *= 0.92
        }
        const intensity = pad.intensity
        const baseMaterial = pad.mesh.material as THREE.ShaderMaterial
        const haloMaterial = pad.halo.material as THREE.ShaderMaterial
        baseMaterial.uniforms.uIntensity.value = intensity
        baseMaterial.uniforms.uColor.value = pad.baseColor
        haloMaterial.uniforms.uIntensity.value = intensity
        haloMaterial.uniforms.uColor.value = pad.baseColor
        const press = 1 - intensity * 0.02
        pad.mesh.scale.set(pad.mesh.scale.x, pad.mesh.scale.y * press, 1)
      })

      renderer.render(scene, camera)
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('scroll', updateLayout)
      window.removeEventListener('resize', updateLayout)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      renderer.dispose()
      noise.dispose()
      chassis.geometry.dispose()
      chassisMaterial.dispose()
      padGeometry.dispose()
      haloGeometry.dispose()
      pads.forEach((pad) => {
        ;(pad.mesh.material as THREE.ShaderMaterial).dispose()
        ;(pad.halo.material as THREE.ShaderMaterial).dispose()
      })
      container.removeChild(renderer.domElement)
    }
  }, [padMaterials])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute left-0 top-0 z-0 h-0 w-0"
    />
  )
}
