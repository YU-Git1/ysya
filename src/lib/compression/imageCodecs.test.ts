import { describe, expect, it } from 'vitest'
import { getGifPaletteSize, getPngOptimisationLevel } from './imageCodecs'

describe('GIF compression palette', () => {
  it.each([[1, 256], [2, 224], [3, 176], [4, 112], [5, 64]] as const)(
    'maps compression level %i to %i palette colors',
    (level, expected) => expect(getGifPaletteSize(level)).toBe(expected),
  )

  it('clamps levels to the supported range', () => {
    expect(getGifPaletteSize(0)).toBe(256)
    expect(getGifPaletteSize(6)).toBe(64)
  })
})

describe('PNG lossless optimization level', () => {
  it.each([[1, 1], [2, 2], [3, 3], [4, 4], [5, 4]] as const)(
    'maps compression level %i to oxipng level %i',
    (level, expected) => expect(getPngOptimisationLevel(level)).toBe(expected),
  )

  it('clamps levels to the supported range', () => {
    expect(getPngOptimisationLevel(0)).toBe(1)
    expect(getPngOptimisationLevel(6)).toBe(4)
  })
})
