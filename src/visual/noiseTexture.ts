import * as THREE from 'three'

export const createNoiseTexture = (size = 64) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.Texture()
  }
  const imageData = ctx.createImageData(size, size)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const value = 30 + Math.random() * 80
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(8, 8)
  texture.needsUpdate = true
  return texture
}
