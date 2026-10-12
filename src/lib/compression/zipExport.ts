import { Zip, ZipPassThrough } from 'fflate'

export type ZipFileInput = { name: string; path?: string; blob: Blob }
const ZIP_READ_CHUNK_BYTES = 1024 * 1024

export function uniqueZipPath(path: string, usedPaths: Set<string>) {
  const normalized = path.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/') || 'image'
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized)
    return normalized
  }
  const separator = normalized.lastIndexOf('/')
  const directory = separator >= 0 ? normalized.slice(0, separator + 1) : ''
  const filename = separator >= 0 ? normalized.slice(separator + 1) : normalized
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''
  let counter = 2
  let unique = `${directory}${base} (${counter})${extension}`
  while (usedPaths.has(unique)) {
    counter += 1
    unique = `${directory}${base} (${counter})${extension}`
  }
  usedPaths.add(unique)
  return unique
}

export async function createZip(files: ZipFileInput[], onProgress: (completed: number) => void) {
  const chunks: Uint8Array[] = []
  let failed: Error | null = null
  let finish!: () => void
  const finished = new Promise<void>((resolve) => { finish = resolve })
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed = error
      finish()
      return
    }
    chunks.push(chunk)
    if (final) {
      onProgress(files.length)
      finish()
    }
  })
  const usedPaths = new Set<string>()

  for (const [fileIndex, file] of files.entries()) {
    if (failed) throw failed
    const entryName = uniqueZipPath(`${file.path ? `${file.path}/` : ''}${file.name}`, usedPaths)
    const entry = new ZipPassThrough(entryName)
    zip.add(entry)
    if (file.blob.size === 0) {
      entry.push(new Uint8Array(), true)
    } else {
      const stream = typeof file.blob.stream === 'function' ? file.blob.stream() : null
      const reader = stream?.getReader()
      let pending: Uint8Array | null = null
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (pending) entry.push(pending, false)
          pending = value
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
      } else {
        for (let offset = 0; offset < file.blob.size; offset += ZIP_READ_CHUNK_BYTES) {
          const buffer = await file.blob.slice(offset, offset + ZIP_READ_CHUNK_BYTES).arrayBuffer()
          if (pending) entry.push(pending, false)
          pending = new Uint8Array(buffer)
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
      }
      if (pending) entry.push(pending, true)
    }
    onProgress(fileIndex + 1)
  }
  zip.end()
  await finished
  if (failed) throw failed
  return new Blob(chunks.map((chunk) => new Uint8Array(chunk)), { type: 'application/zip' })
}
