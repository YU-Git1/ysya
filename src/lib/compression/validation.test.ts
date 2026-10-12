import { describe, expect, it } from 'vitest'
import { MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_FILE_BYTES, detectInputFormat, validateFiles } from './validation'

function makeFile(name: string, type: string, size = 1024) {
  return { name, type, size } as File
}

describe('detectInputFormat', () => {
  it.each([
    ['photo.JPG', 'image/jpeg', 'jpeg'],
    ['graphic.avif', 'image/avif', 'avif'],
    ['animation.gif', 'image/gif', 'gif'],
    ['scan.tiff', '', 'tiff'],
    ['phone.HEIC', 'application/octet-stream', 'heic'],
  ] as const)('detects %s as %s', (name, type, expected) => {
    expect(detectInputFormat({ name, type })).toBe(expected)
  })

  it('rejects unknown extensions', () => {
    expect(detectInputFormat({ name: 'document.pdf', type: 'application/pdf' })).toBeNull()
  })
})

describe('validateFiles', () => {
  it('enforces the file and batch byte limits', () => {
    const files = [
      makeFile('oversize.jpg', 'image/jpeg', MAX_FILE_BYTES + 1),
      makeFile('valid.png', 'image/png', 2),
      makeFile('batch-limit.webp', 'image/webp', 2),
    ]
    const result = validateFiles(files, 0, MAX_BATCH_BYTES - 2)
    expect(result.accepted.map((file) => file.name)).toEqual(['valid.png'])
    expect(result.errors.map(({ reason }) => reason)).toEqual(['file-too-large', 'batch-size-limit'])
  })

  it('respects existing queued item count', () => {
    const result = validateFiles([makeFile('next.png', 'image/png')], MAX_BATCH_FILES)
    expect(result.accepted).toHaveLength(0)
    expect(result.errors[0]?.reason).toBe('batch-file-limit')
  })

  it('exports the documented limits', () => {
    expect(MAX_BATCH_FILES).toBe(200)
    expect(MAX_BATCH_BYTES).toBe(512 * 1024 * 1024)
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024)
  })
})
