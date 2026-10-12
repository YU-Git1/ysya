import * as UTIF from 'utif'
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { decompressFrames, parseGIF } from 'gifuct-js'

export type DecodedFrame = { imageData: ImageData; delay: number }
export type DecodedImage = { canvas: HTMLCanvasElement; frames?: DecodedFrame[] }

const MAX_IMAGE_PIXELS = 40_000_000
const MAX_ANIMATION_PIXELS = 60_000_000
const MAX_GIF_FRAMES = 300

function createCanvas(imageData: ImageData) {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
  context.putImageData(imageData, 0, 0)
  return canvas
}

async function decodeGif(file: File): Promise<DecodedImage> {
  const parsed = parseGIF(await file.arrayBuffer())
  const frames = decompressFrames(parsed, true)
  const pixelCount = parsed.lsd.width * parsed.lsd.height
  if (pixelCount > MAX_IMAGE_PIXELS || frames.length > MAX_GIF_FRAMES || pixelCount * frames.length > MAX_ANIMATION_PIXELS) throw new Error('IMAGE_TOO_COMPLEX')

  const canvas = document.createElement('canvas')
  canvas.width = parsed.lsd.width
  canvas.height = parsed.lsd.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
  const decodedFrames: DecodedFrame[] = []
  let restorePrevious: ImageData | null = null

  for (const frame of frames) {
    const disposal = frame.disposalType
    if (disposal === 3 && restorePrevious) context.putImageData(restorePrevious, 0, 0)
    if (disposal === 2) context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
    restorePrevious = disposal === 3 ? context.getImageData(0, 0, canvas.width, canvas.height) : null
    const patch = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height)
    const patchCanvas = createCanvas(patch)
    context.drawImage(patchCanvas, frame.dims.left, frame.dims.top)
    decodedFrames.push({ imageData: context.getImageData(0, 0, canvas.width, canvas.height), delay: frame.delay || 100 })
  }
  if (decodedFrames[0]) context.putImageData(decodedFrames[0].imageData, 0, 0)
  return { canvas, frames: decodedFrames }
}

async function decodeTiff(file: File): Promise<DecodedImage> {
  const buffer = await file.arrayBuffer()
  const directories = UTIF.decode(buffer)
  const firstPage = directories[0]
  if (!firstPage) throw new Error('UNSUPPORTED_OR_CORRUPT_IMAGE')
  if (firstPage.width * firstPage.height > MAX_IMAGE_PIXELS) throw new Error('IMAGE_TOO_COMPLEX')
  UTIF.decodeImage(buffer, firstPage)
  return { canvas: createCanvas(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(firstPage)), firstPage.width, firstPage.height)) }
}

async function decodeHeic(file: File) {
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/png' })
  const blob = Array.isArray(converted) ? converted[0] : converted
  const bitmap = await createImageBitmap(blob)
  if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close()
    throw new Error('IMAGE_TOO_COMPLEX')
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { canvas }
}

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  const mime = file.type.toLowerCase()
  if (mime === 'image/gif' || extension === 'gif') return decodeGif(file)
  if (mime === 'image/tiff' || extension === 'tif' || extension === 'tiff') return decodeTiff(file)
  if (mime === 'image/heic' || mime === 'image/heif' || extension === 'heic' || extension === 'heif') return decodeHeic(file)
  if (mime === 'image/avif' || extension === 'avif') {
    const { default: decodeAvif } = await import('@jsquash/avif/decode')
    const imageData = await decodeAvif(await file.arrayBuffer())
    if (!imageData || imageData.width * imageData.height > MAX_IMAGE_PIXELS) throw new Error('IMAGE_TOO_COMPLEX')
    return { canvas: createCanvas(imageData) }
  }
  const bitmap = await createImageBitmap(file)
  if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close()
    throw new Error('IMAGE_TOO_COMPLEX')
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { canvas }
}

export async function encodeImage(canvas: HTMLCanvasElement, mime: string, quality?: number, frames?: DecodedFrame[]) {
  if (mime === 'image/avif') {
    const { default: encodeAvif } = await import('@jsquash/avif/encode')
    const imageData = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height)
    if (!imageData) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
    const bytes = await encodeAvif(imageData, { quality: Math.round((quality ?? 0.7) * 100), speed: 6 })
    return new Blob([bytes], { type: mime })
  }
  if (mime === 'image/tiff') {
    const imageData = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height)
    if (!imageData) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
    const bytes = UTIF.encodeImage(new Uint8Array(imageData.data), canvas.width, canvas.height)
    return new Blob([bytes], { type: mime })
  }
  if (mime === 'image/gif') {
    const encoder = GIFEncoder()
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
    const outputFrames = frames?.length ? frames : [{ imageData: context.getImageData(0, 0, canvas.width, canvas.height), delay: 100 }]
    outputFrames.forEach((frame, index) => {
      const rgba = frame.imageData.data
      const palette = quantize(rgba, index === 0 ? 256 : 256, { format: 'rgba4444', oneBitAlpha: true })
      encoder.writeFrame(applyPalette(rgba, palette, 'rgba4444'), frame.imageData.width, frame.imageData.height, {
        palette,
        delay: frame.delay,
        transparent: true,
        transparentIndex: palette.findIndex((color) => color[3] < 128),
      })
    })
    encoder.finish()
    return new Blob([Uint8Array.from(encoder.bytes()).buffer], { type: mime })
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('ENCODE_FAILED')), mime, quality)
  })
}
