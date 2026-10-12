export function getCompressionConcurrency(deviceMemory = navigator.deviceMemory ?? 4, hardwareConcurrency = navigator.hardwareConcurrency ?? 2) {
  return deviceMemory <= 2 || hardwareConcurrency <= 2 ? 1 : 2
}

export class TaskScheduler<T> {
  private queue: T[] = []
  private active = 0
  private paused = false

  constructor(private readonly concurrency: number, private readonly process: (item: T) => Promise<void>) {}

  enqueue(items: T[]) {
    this.queue.push(...items)
    this.pump()
  }

  removeQueued(predicate: (item: T) => boolean) {
    const previousLength = this.queue.length
    this.queue = this.queue.filter((item) => !predicate(item))
    return previousLength - this.queue.length
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.pump()
  }

  private pump() {
    while (!this.paused && this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!
      this.active += 1
      void this.process(item).finally(() => {
        this.active -= 1
        this.pump()
      })
    }
  }
}

export async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number, shouldPause: () => boolean = () => false) {
  const results: T[] = new Array(tasks.length)
  let nextTask = 0

  async function worker() {
    while (nextTask < tasks.length) {
      if (shouldPause()) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
        continue
      }
      const index = nextTask
      nextTask += 1
      results[index] = await tasks[index]()
    }
  }

  await Promise.all(Array.from({ length: Math.min(tasks.length, Math.max(1, concurrency)) }, () => worker()))
  return results
}
