import { uniqueZipPath, type ZipFileInput } from './zipExport'

type WritableFile = { write: (blob: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }
type FileHandle = { createWritable: () => Promise<WritableFile> }
export type DirectoryHandle = {
  getDirectoryHandle: (name: string, options: { create: boolean }) => Promise<DirectoryHandle>
  getFileHandle: (name: string, options: { create: boolean }) => Promise<FileHandle>
}

export async function writeFilesToDirectory(root: DirectoryHandle, files: ZipFileInput[]) {
  const usedPaths = new Set<string>()

  for (const file of files) {
    const path = uniqueZipPath(`${file.path ? `${file.path}/` : ''}${file.name}`, usedPaths)
    const segments = path.split('/')
    const name = segments.pop()
    if (!name) continue

    let directory = root
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true })
    const handle = await directory.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(file.blob)
      await writable.close()
    } catch (error) {
      await writable.abort?.()
      throw error
    }
  }
}
