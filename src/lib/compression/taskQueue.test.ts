import { describe, expect, it } from 'vitest'
import { getCompressionConcurrency, runWithConcurrency, TaskScheduler } from './taskQueue'

describe('compression task queue', () => {
  it('limits work to device capacity and never exceeds the upper bound', () => {
    expect(getCompressionConcurrency(2, 8)).toBe(1)
    expect(getCompressionConcurrency(8, 2)).toBe(1)
    expect(getCompressionConcurrency(8, 8)).toBe(2)
    expect(getCompressionConcurrency(32, 32)).toBe(2)
  })

  it('runs tasks in input order while respecting concurrency', async () => {
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 8 }, (_, index) => async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return index
    })

    await expect(runWithConcurrency(tasks, 2)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(peak).toBe(2)
  })

  it('removes queued work before it is dispatched', async () => {
    const processed: number[] = []
    const scheduler = new TaskScheduler<number>(1, async (item) => { processed.push(item) })
    scheduler.setPaused(true)
    scheduler.enqueue([1, 2, 3])
    expect(scheduler.removeQueued((item) => item === 2)).toBe(1)
    scheduler.setPaused(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(processed).toEqual([1, 3])
  })
})
