'use strict'

const test = require('tape')
const buildQueue = require('../').promise

async function delay (ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

test('after stress it should settle peacefully', async function (t) {
  const queue = buildQueue(worker, 100)
  let sum = 0
  let randomAddition = 0
  let iteration = 10000

  async function worker (num) {
    await delay(10)
    sum += num
    await delay(10)
  }

  function randomPush () {
    if (Math.random() < 0.5) {
      queue.push(1)
      randomAddition++
    }
  }

  while (iteration--) {
    if (queue.idle()) {
      for (let i = 0; i < 100; i++) {
        queue.push(i)
      }
      continue
    }

    await queue.drained()

    randomPush()

    await queue.drained()
  }

  await queue.drained()

  t.equal(queue.running(), 0)
  t.equal(sum, 247500 + randomAddition)
})
