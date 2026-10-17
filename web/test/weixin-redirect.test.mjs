import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const html = readFileSync(new URL('../public/open-weixin.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../public/open-weixin.js', import.meta.url), 'utf8')
const target = 'weixin://dl/business/?appid=wx5306c5978fdb76e4'

test('standalone HTML retains a manual WeChat link with JavaScript disabled', () => {
  assert.ok(html.includes(`href="${target}"`))
  assert.match(html, /打开微信小程序<\/a>/)
})

test('page load attempts the same WeChat launch once; blocked launch leaves fallback available', () => {
  for (const blocked of [false, true]) {
    const link = { href: target }
    let callback
    const attempts = []
    vm.runInNewContext(script, {
      document: { getElementById: () => link },
      window: {
        addEventListener: (event, fn, options) => {
          assert.equal(event, 'load')
          assert.equal(options.once, true)
          callback = fn
        },
        location: { replace: (url) => {
          attempts.push(url)
          if (blocked)
            throw new Error('browser blocked launch')
        } },
      },
    })
    assert.equal(attempts.length, 0)
    assert.doesNotThrow(() => callback())
    assert.deepEqual(attempts, [target])
    assert.equal(link.href, target)
  }
})
