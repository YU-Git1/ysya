import { decodeImageFile, encodeImage, type DecodedFrame } from './imageCodecs'
import { detectInputFormat } from './validation'

export type LocalOutputFormat = 'original' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif' | 'image/tiff'
export const COMPRESSION_LEVELS = [20, 35, 50, 65, 80] as const

export type LocalCompressionResult = {
  blob: Blob
  width: number
  height: number
  mime: string
  formatLabel: string
  quality?: number
}

type ProgressCallback = (progress: number) => void
type PauseCheck = () => boolean

const QUALITY_RANGES: readonly (readonly [number, number])[] = [
  [0.92, 0.84],
  [0.88, 0.74],
  [0.82, 0.64],
  [0.76, 0.54],
  [0.68, 0.42],
] as const
const MIN_VISUAL_SCORES = [0.997, 0.992, 0.985, 0.972, 0.95]

export function getOutputMime(file: File, outputFormat: LocalOutputFormat) {
  if (outputFormat !== 'original') return outputFormat
  const inputFormat = detectInputFormat(file)
  if (inputFormat === 'png') return 'image/png'
  if (inputFormat === 'webp') return 'image/webp'
  if (inputFormat === 'avif') return 'image/avif'
  if (inputFormat === 'gif') return 'image/gif'
  if (inputFormat === 'tiff') return 'image/tiff'
  return 'image/jpeg'
}

export function getFormatLabel(mime: string) {
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WebP'
  if (mime === 'image/avif') return 'AVIF'
  if (mime === 'image/gif') return 'GIF'
  if (mime === 'image/tiff') return 'TIFF'
  if (mime === 'image/heic' || mime === 'image/heif') return 'HEIC'
  return 'JPG'
}

function waitForResume(isPaused: PauseCheck) {
  if (!isPaused()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const check = () => {
      if (!isPaused()) resolve()
      else window.setTimeout(check, 80)
    }
    check()
  })
}

function createSample(canvas: HTMLCanvasElement) {
  const sample = document.createElement('canvas')
  const scale = Math.min(1, 128 / Math.max(canvas.width, canvas.height))
  sample.width = Math.max(1, Math.round(canvas.width * scale))
  sample.height = Math.max(1, Math.round(canvas.height * scale))
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
  context.drawImage(canvas, 0, 0, sample.width, sample.height)
  return sample
}

async function visualScore(sourceSample: HTMLCanvasElement, blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const candidate = document.createElement('canvas')
    candidate.width = sourceSample.width
    candidate.height = sourceSample.height
    const context = candidate.getContext('2d', { willReadFrequently: true })
    if (!context) return 0
    context.drawImage(bitmap, 0, 0, candidate.width, candidate.height)
    const sourcePixels = sourceSample.getContext('2d')?.getImageData(0, 0, candidate.width, candidate.height).data
    const candidatePixels = context.getImageData(0, 0, candidate.width, candidate.height).data
    if (!sourcePixels) return 0
    let error = 0
    for (let index = 0; index < sourcePixels.length; index += 4) {
      error += Math.abs(sourcePixels[index] - candidatePixels[index])
      error += Math.abs(sourcePixels[index + 1] - candidatePixels[index + 1])
      error += Math.abs(sourcePixels[index + 2] - candidatePixels[index + 2])
    }
    return 1 - error / (sourcePixels.length / 4 * 3 * 255)
  } finally {
    bitmap.close()
  }
}

async function chooseLossyCandidate(canvas: HTMLCanvasElement, mime: string, inputSize: number, compressionLevel: number, isPaused: PauseCheck, onProgress: ProgressCallback) {
  const levelIndex = Math.min(QUALITY_RANGES.length - 1, Math.max(0, Math.round(compressionLevel) - 1))
  const [high, low] = QUALITY_RANGES[levelIndex]
  const sourceSample = createSample(canvas)
  const targetBytes = Math.max(1, Math.round(inputSize * (1 - COMPRESSION_LEVELS[levelIndex] / 100)))
  const minimumScore = MIN_VISUAL_SCORES[levelIndex]
  const cache = new Map<number, { blob: Blob; score: number }>()
  const qualities = new Set([high, low])
  let bestAcceptable: { blob: Blob; quality: number; score: number } | undefined
  let bestAny: { blob: Blob; quality: number; score: number } | undefined

  // A bounded binary search spends at most five encodes per image and narrows around the requested size.
  let left = low
  let right = high
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await waitForResume(isPaused)
    const quality = Number((attempt === 0 ? high : attempt === 1 ? low : (left + right) / 2).toFixed(3))
    if (qualities.has(quality) && cache.has(quality)) continue
    qualities.add(quality)
    const blob = await encodeImage(canvas, mime, quality)
    const score = await visualScore(sourceSample, blob)
    cache.set(quality, { blob, score })
    const candidate = { blob, quality, score }
    if (!bestAny || Math.abs(blob.size - targetBytes) < Math.abs(bestAny.blob.size - targetBytes) || (blob.size === bestAny.blob.size && score > bestAny.score)) bestAny = candidate
    if (score >= minimumScore && (!bestAcceptable || Math.abs(blob.size - targetBytes) < Math.abs(bestAcceptable.blob.size - targetBytes))) bestAcceptable = candidate
    if (blob.size > targetBytes) right = quality
    else left = quality
    onProgress(20 + Math.round(((attempt + 1) / 5) * 75))
  }
  return bestAcceptable ?? bestAny!
}

export async function compressLocally(
  file: File,
  outputFormat: LocalOutputFormat,
  compressionLevel: number,
  onProgress: ProgressCallback,
  isPaused: PauseCheck,
): Promise<LocalCompressionResult> {
  await waitForResume(isPaused)
  const mime = getOutputMime(file, outputFormat)
  const inputFormat = detectInputFormat(file)
  if (outputFormat === 'original' && ['gif', 'heic', 'tiff'].includes(inputFormat ?? '')) {
    onProgress(100)
    const inputMime = inputFormat === 'tiff' ? 'image/tiff' : inputFormat === 'gif' ? 'image/gif' : file.type || 'image/heic'
    return { blob: file, width: 0, height: 0, mime: inputMime, formatLabel: getFormatLabel(inputMime) }
  }
  const decoded = await decodeImageFile(file)
  const { canvas, frames } = decoded
  const width = canvas.width
  const height = canvas.height
  onProgress(18)

  if (mime === 'image/png' || mime === 'image/tiff' || mime === 'image/gif') {
    await waitForResume(isPaused)
    const blob = await encodeImage(canvas, mime, undefined, mime === 'image/gif' ? frames : undefined)
    onProgress(100)
    return { blob, width, height, mime, formatLabel: getFormatLabel(mime) }
  }

  const best = await chooseLossyCandidate(canvas, mime, file.size, compressionLevel, isPaused, onProgress)
  onProgress(100)
  return { blob: best.blob, width, height, mime, formatLabel: getFormatLabel(mime), quality: best.quality }
}

export type { DecodedFrame }
