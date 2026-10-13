/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Navigator {
  deviceMemory?: number
}

declare module 'gifenc' {
  export type GifColor = number[]
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: GifColor[], format?: string): Uint8Array
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): GifColor[]
  export function GIFEncoder(options?: Record<string, unknown>): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: Record<string, unknown>): void
    finish(): void
    bytes(): Uint8Array
  }
}
