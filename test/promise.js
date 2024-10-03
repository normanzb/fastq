'use strict'

const test = require('tape')
const buildQueue = require('../').promise
const { promisify } = require('util')
const sleep = promisify(setTimeout)
const immediate = promisify(setImmediate)

test('concurrency', function (t) {
  t.plan(2)
  t.throws(buildQueue.bind(null, worker, 0))
  t.doesNotThrow(buildQueue.bind(null, worker, 1))

  async function worker (arg) {
    return true
  }
})

test('worker execution', async function (t) {
  const queue = buildQueue(worker, 1)

  const result = await queue.push(42)

  t.equal(result, true, 'result matches')

  async function worker (arg) {
    t.equal(arg, 42)
    return true
  }
})

test('limit', async function (t) {
  const queue = buildQueue(worker, 1)

  const [res1, res2] = await Promise.all([queue.push(10), queue.push(0)])
  t.equal(res1, 10, 'the result matches')
  t.equal(res2, 0, 'the result matches')

  async function worker (arg) {
    await sleep(arg)
    return arg
  }
})

test('multiple executions', async function (t) {
  const queue = buildQueue(worker, 1)
  const toExec = [1, 2, 3, 4, 5]
  const expected = ['a', 'b', 'c', 'd', 'e']
  let count = 0

  await Promise.all(toExec.map(async function (task, i) {
    const result = await queue.push(task)
    t.equal(result, expected[i], 'the result matches')
  }))

  async function worker (arg) {
    t.equal(arg, toExec[count], 'arg matches')
    return expected[count++]
  }
})

test('drained', async function (t) {
  const queue = buildQueue(worker, 2)

  const toExec = new Array(10).fill(10)
  let count = 0

  async function worker (arg) {
    await sleep(arg)
    count++
  }

  toExec.forEach(function (i) {
    queue.push(i)
  })

  await queue.drained()

  t.equal(count, toExec.length)

  toExec.forEach(function (i) {
    queue.push(i)
  })

  await queue.drained()

  t.equal(count, toExec.length * 2)
})

test('drained with exception should not throw', async function (t) {
  const queue = buildQueue(worker, 2)

  const toExec = new Array(10).fill(10)

  async function worker () {
    throw new Error('foo')
  }

  toExec.forEach(function (i) {
    queue.push(i)
  })

  await queue.drained()
})

test('drained while idle should resolve', async function (t) {
  const queue = buildQueue(worker, 2)

  async function worker (arg) {
    await sleep(arg)
  }

  await queue.drained()
})

test('drained while idle should not call the drain function', async function (t) {
  let drainCalled = false
  const queue = buildQueue(worker, 2)

  queue.drain = function () {
    drainCalled = true
  }

  async function worker (arg) {
    await sleep(arg)
  }

  await queue.drained()

  t.equal(drainCalled, false)
})

test('drained returns same promise until it is drained and new item is pushed', async function (t) {
  const queue = buildQueue(worker, 1)
  let resolveWorker

  async function worker () {
    return new Promise(resolve => {
      resolveWorker = resolve
    })
  }

  queue.push(1)
  const drainedPromise1 = queue.drained()
  const drainedPromise2 = queue.drained()

  t.equal(drainedPromise1, drainedPromise2)

  resolveWorker?.()
  await Promise.all([drainedPromise1, drainedPromise2])

  queue.push(3)
  const drainedPromise3 = queue.drained()

  t.notEqual(drainedPromise1, drainedPromise3)

  const thenHandler = t.captureFn(() => {})
  drainedPromise3.then(thenHandler)

  await new Promise(resolve => {
    setImmediate(resolve)
  })

  t.equal(thenHandler.calls.length, 0)
})

test('drained 14000+ times should not cause drain.resolve() to throw', async function (t) {
  const queue = buildQueue(worker, 1)
  let resolveWorker

  async function worker (arg) {
    return new Promise(resolve => {
      resolveWorker = resolve
    })
  }

  // the number needs to be large enough to break the stack size
  // if the drained function keeps wrapping previousDrain() inside another drain()
  for (let i = 0; i < 14000; i++) {
    queue.push(1)
    const drainedPromise = queue.drained()
    resolveWorker?.()
    await drainedPromise
  }

  t.doesNotThrow(async () => {
    queue.drain?.resolve()
  })
})

test('set this', async function (t) {
  t.plan(1)
  const that = {}
  const queue = buildQueue(that, worker, 1)

  await queue.push(42)

  async function worker (arg) {
    t.equal(this, that, 'this matches')
  }
})

test('unshift', async function (t) {
  const queue = buildQueue(worker, 1)
  const expected = [1, 2, 3, 4]

  await Promise.all([
    queue.push(1),
    queue.push(4),
    queue.unshift(3),
    queue.unshift(2)
  ])

  t.is(expected.length, 0)

  async function worker (arg) {
    t.equal(expected.shift(), arg, 'tasks come in order')
  }
})

test('push with worker throwing error', async function (t) {
  t.plan(5)
  const q = buildQueue(async function (task, cb) {
    throw new Error('test error')
  }, 1)
  q.error(function (err, task) {
    t.ok(err instanceof Error, 'global error handler should catch the error')
    t.match(err.message, /test error/, 'error message should be "test error"')
    t.equal(task, 42, 'The task executed should be passed')
  })
  try {
    await q.push(42)
  } catch (err) {
    t.ok(err instanceof Error, 'push callback should catch the error')
    t.match(err.message, /test error/, 'error message should be "test error"')
  }
})

test('unshift with worker throwing error', async function (t) {
  t.plan(2)
  const q = buildQueue(async function (task, cb) {
    throw new Error('test error')
  }, 1)
  try {
    await q.unshift(42)
  } catch (err) {
    t.ok(err instanceof Error, 'push callback should catch the error')
    t.match(err.message, /test error/, 'error message should be "test error"')
  }
})

test('no unhandledRejection (push)', async function (t) {
  function handleRejection () {
    t.fail('unhandledRejection')
  }
  process.once('unhandledRejection', handleRejection)
  const q = buildQueue(async function (task, cb) {
    throw new Error('test error')
  }, 1)

  q.push(42)

  await immediate()
  process.removeListener('unhandledRejection', handleRejection)
})

test('no unhandledRejection (unshift)', async function (t) {
  function handleRejection () {
    t.fail('unhandledRejection')
  }
  process.once('unhandledRejection', handleRejection)
  const q = buildQueue(async function (task, cb) {
    throw new Error('test error')
  }, 1)

  q.unshift(42)

  await immediate()
  process.removeListener('unhandledRejection', handleRejection)
})
