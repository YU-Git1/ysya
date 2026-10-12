import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { createZip, uniqueZipPath } from './zipExport'

describe('ZIP export', () => {
  it('preserves folder paths and gives duplicate names unique paths', async () => {
    const blob = await createZip([
      { path: 'folder one/sub', name: 'photo.jpg', blob: new Blob(['first']) },
      { path: 'folder one/sub', name: 'photo.jpg', blob: new Blob(['second']) },
    ], () => {})
    const contents = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(contents)).toEqual(['folder one/sub/photo.jpg', 'folder one/sub/photo (2).jpg'])
    expect(new TextDecoder().decode(contents['folder one/sub/photo.jpg'])).toBe('first')
    expect(new TextDecoder().decode(contents['folder one/sub/photo (2).jpg'])).toBe('second')
  })

  it('normalizes unsafe path segments', () => {
    expect(uniqueZipPath('../a/../../image.png', new Set())).toBe('a/image.png')
  })

  it('streams large blobs in bounded chunks', async () => {
    const contents = 'a'.repeat(1024 * 1024 + 11)
    const blob = await createZip([{ name: 'large.txt', blob: new Blob([contents]) }], () => {})
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(archive['large.txt']).toHaveLength(contents.length)
  })
})
