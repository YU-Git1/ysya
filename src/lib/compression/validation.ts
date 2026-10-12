export type SupportedInputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'heic'

export const SUPPORTED_INPUT_FORMATS: Record<SupportedInputFormat, { mimeTypes: string[]; extensions: string[] }> = {
  jpeg: { mimeTypes: ['image/jpeg'], extensions: ['jpg', 'jpeg'] },
  png: { mimeTypes: ['image/png'], extensions: ['png'] },
  webp: { mimeTypes: ['image/webp'], extensions: ['webp'] },
  avif: { mimeTypes: ['image/avif'], extensions: ['avif'] },
  gif: { mimeTypes: ['image/gif'], extensions: ['gif'] },
  tiff: { mimeTypes: ['image/tiff'], extensions: ['tif', 'tiff'] },
  heic: { mimeTypes: ['image/heic', 'image/heif'], extensions: ['heic', 'heif'] },
}

export const MAX_BATCH_FILES = 200
export const MAX_BATCH_BYTES = 512 * 1024 * 1024
export const MAX_FILE_BYTES = 20 * 1024 * 1024

export type FileValidationError = 'unsupported' | 'file-too-large' | 'batch-file-limit' | 'batch-size-limit'

export function detectInputFormat(file: Pick<File, 'name' | 'type'>): SupportedInputFormat | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const formats = Object.entries(SUPPORTED_INPUT_FORMATS) as [SupportedInputFormat, typeof SUPPORTED_INPUT_FORMATS[SupportedInputFormat]][]
  return formats.find(([, details]) => details.mimeTypes.includes(file.type.toLowerCase()) || details.extensions.includes(extension))?.[0] ?? null
}

export function validateFiles(files: File[], existingCount = 0, existingBytes = 0) {
  const accepted: File[] = []
  const errors: { file: File; reason: FileValidationError }[] = []
  let totalBytes = existingBytes

  for (const file of files) {
    if (!detectInputFormat(file)) {
      errors.push({ file, reason: 'unsupported' })
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push({ file, reason: 'file-too-large' })
      continue
    }
    if (existingCount + accepted.length >= MAX_BATCH_FILES) {
      errors.push({ file, reason: 'batch-file-limit' })
      continue
    }
    if (totalBytes + file.size > MAX_BATCH_BYTES) {
      errors.push({ file, reason: 'batch-size-limit' })
      continue
    }
    accepted.push(file)
    totalBytes += file.size
  }

  return { accepted, errors, totalBytes }
}
