import { describe, expect, it } from 'vitest'
import { writeFilesToDirectory, type DirectoryHandle } from './folderExport'

function createDirectoryMock(files: Map<string, string>, prefix = ''): DirectoryHandle {
  return {
    async getDirectoryHandle(name, { create }) {
      expect(create).toBe(true)
      return createDirectoryMock(files, `${prefix}${name}/`)
    },
    async getFileHandle(name, { create }) {
      expect(create).toBe(true)
      const path = `${prefix}${name}`
      return {
        async createWritable() {
          return {
            async write(blob) { files.set(path, await blob.text()) },
            async close() {},
          }
        },
      }
    },
  }
}

describe('folder export', () => {
  it('writes files into relative directories and handles name collisions', async () => {
    const files = new Map<string, string>()
    await writeFilesToDirectory(createDirectoryMock(files), [
      { path: 'photos/trip', name: 'image.jpg', blob: new Blob(['first']) },
      { path: 'photos/trip', name: 'image.jpg', blob: new Blob(['second']) },
    ])

    expect([...files.entries()]).toEqual([
      ['photos/trip/image.jpg', 'first'],
      ['photos/trip/image (2).jpg', 'second'],
    ])
  })
})
