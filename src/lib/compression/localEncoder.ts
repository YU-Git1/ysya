export type LocalOutputFormat = 'original' | 'image/jpeg' | 'image/png' | 'image/webp'
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

const LOSSY_QUALITIES = [0.98, 0.94, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.64, 0.58, 0.52, 0.46]
const QUALITY_FLOORS = [0.997, 0.992, 0.985, 0.972, 0.95]
const SAMPLE_SIZE = 96

function getFormat(file: File, outputFormat: LocalOutputFormat) {
  if (outputFormat !== 'original') return outputFormat
  if (file.type === 'image/png') return 'image/png'
  if (file.type === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

function getFormatLabel(mime: string) {
  return mime === 'image/png' ? 'PNG' : mime === 'image/webp' ? 'WebP' : 'JPG'
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

async function loadSource(file: File) {
  if ('createImageBitmap' in window) return createImageBitmap(file)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawSource(source: CanvasImageSource, mime: string) {
  const imageSource = source as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }
  const width = imageSource.naturalWidth ?? imageSource.width
  const height = imageSource.naturalHeight ?? imageSource.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
  if (mime === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(source, 0, 0)
  return { canvas, width, height }
}

function blobFromCanvas(canvas: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('ENCODE_FAILED'))), mime, quality)
  })
}

function createSample(canvas: HTMLCanvasElement) {
  const sample = document.createElement('canvas')
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(canvas.width, canvas.height))
  sample.width = Math.max(1, Math.round(canvas.width * scale))
  sample.height = Math.max(1, Math.round(canvas.height * scale))
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('BROWSER_CANVAS_UNAVAILABLE')
  context.drawImage(canvas, 0, 0, sample.width, sample.height)
  return sample
}

async function visualScore(sourceSample: HTMLCanvasElement, blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const candidate = document.createElement('canvas')
  candidate.width = sourceSample.width
  candidate.height = sourceSample.height
  const context = candidate.getContext('2d', { willReadFrequently: true })
  if (!context) return 0
  context.drawImage(bitmap, 0, 0, candidate.width, candidate.height)
  bitmap.close()
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
}

export async function compressLocally(
  file: File,
  outputFormat: LocalOutputFormat,
  compressionLevel: number,
  onProgress: ProgressCallback,
  isPaused: PauseCheck,
): Promise<LocalCompressionResult> {
  await waitForResume(isPaused)
  const mime = getFormat(file, outputFormat)
  const source = await loadSource(file)
  const { canvas, width, height } = drawSource(source, mime)
  if ('close' in source && typeof source.close === 'function') source.close()
  onProgress(18)

  if (mime === 'image/png') {
    const blob = await blobFromCanvas(canvas, mime)
    onProgress(100)
    return { blob, width, height, mime, formatLabel: getFormatLabel(mime) }
  }

  const sourceSample = createSample(canvas)
  const levelIndex = Math.min(COMPRESSION_LEVELS.length - 1, Math.max(0, Math.round(compressionLevel) - 1))
  const targetReduction = COMPRESSION_LEVELS[levelIndex] / 100
  const targetBytes = Math.max(1, Math.round(file.size * (1 - targetReduction)))
  const qualityFloor = QUALITY_FLOORS[levelIndex]
  const candidates: { blob: Blob; quality: number; score: number }[] = []
  for (let index = 0; index < LOSSY_QUALITIES.length; index += 1) {
    await waitForResume(isPaused)
    const quality = LOSSY_QUALITIES[index]
    const blob = await blobFromCanvas(canvas, mime, quality)
    const score = await visualScore(sourceSample, blob)
    candidates.push({ blob, quality, score })
    onProgress(20 + Math.round(((index + 1) / LOSSY_QUALITIES.length) * 75))
  }
  const acceptable = candidates.filter((candidate) => candidate.score >= qualityFloor)
  const pool = acceptable.length ? acceptable : candidates
  const best = pool.reduce((current, candidate) => {
    const currentDistance = Math.abs(current.blob.size - targetBytes)
    const candidateDistance = Math.abs(candidate.blob.size - targetBytes)
    if (candidateDistance < currentDistance) return candidate
    if (candidateDistance === currentDistance && candidate.score > current.score) return candidate
    return current
  })
  onProgress(100)
  return { blob: best.blob, width, height, mime, formatLabel: getFormatLabel(mime), quality: best.quality }
}
