/** Runs at most `concurrency` tasks at once; extra calls queue in order. */
export function createLimiter(concurrency: number) {
  let active = 0
  const queue: (() => void)[] = []

  const next = () => {
    if (active >= concurrency) return
    const start = queue.shift()
    if (start) {
      active++
      start()
    }
  }

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}
