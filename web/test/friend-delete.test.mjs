/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function evaluate(source, imports) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => imports[name] || {}, console })
  return exports
}

function fixture() {
  const account = { currentAccountId: 'a' }
  const calls = []
  const api = {
    async get() { return { data: { ok: true, data: [] } } },
    async post(...args) {
      calls.push(args)
      return { data: { ok: true, message: '删除好友成功' } }
    },
  }
  const { useFriendStore } = evaluate(readFileSync(new URL('../src/stores/friend.ts', import.meta.url), 'utf8'), {
    'vue': { ref: value => ({ value }) },
    'pinia': { defineStore: (_name, setup) => setup },
    '@/api': { default: api },
    '@/stores/account': { useAccountStore: () => account },
  })
  const store = useFriendStore()
  store.friends.value = [{ gid: '11', name: '好友一' }, { gid: 22, name: '好友二' }]
  store.friendLands.value = { 11: [{ id: 1 }], 22: [{ id: 2 }] }
  store.friendLandsLoading.value = { 11: true, 22: false }
  store.knownFriendGids.value = [11, 22]
  return { store, account, api, calls }
}

test('successful deletion uses the existing API and clears only that friend and its lands', async () => {
  const f = fixture()
  const result = await f.store.deleteFriend('a', { gid: 11, name: '好友一', avatarUrl: 'avatar' })
  assert.equal(result.ok, true)
  assert.equal(f.calls[0][0], '/api/friend/11/delete')
  assert.equal(f.calls[0][2].headers['x-account-id'], 'a')
  assert.deepEqual(Array.from(f.store.friends.value, friend => friend.gid), [22])
  assert.equal(f.store.friendLands.value[11], undefined)
  assert.equal(f.store.friendLandsLoading.value[11], undefined)
  assert.equal(f.store.friendLands.value[22][0].id, 2)
  assert.deepEqual(Array.from(f.store.knownFriendGids.value), [22])
  assert.equal(f.store.blacklist.value[0].gid, 11)
  assert.equal(f.store.blacklist.value[0].name, '好友一')
  assert.equal(f.store.deletingFriends.value[11], undefined)
})

test('rejected and network-failed deletions preserve friends and report the backend reason', async () => {
  for (const networkError of [false, true]) {
    const f = fixture()
    f.api.post = async () => {
      if (networkError)
        throw Object.assign(new Error('network failure'), { response: { data: { error: 'game rejected' } } })
      return { data: { ok: false, error: 'game rejected' } }
    }
    const result = await f.store.deleteFriend('a', { gid: 11 })
    assert.equal(result.ok, false)
    assert.equal(result.message, 'game rejected')
    assert.equal(f.store.friends.value.length, 2)
    assert.equal(f.store.friendLands.value[11][0].id, 1)
    assert.equal(f.store.blacklist.value.length, 0)
    assert.equal(f.store.deletingFriends.value[11], undefined)
  }
})

test('pending deletion is submitted once and invalid GIDs never request deletion', async () => {
  const f = fixture()
  let finish
  f.api.post = (...args) => {
    f.calls.push(args)
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = f.store.deleteFriend('a', { gid: 11 })
  assert.equal(f.store.deletingFriends.value[11], true)
  assert.equal((await f.store.deleteFriend('a', { gid: 11 })).ok, false)
  for (const gid of [0, -1, Number.POSITIVE_INFINITY, 1.5, Number.NaN])
    assert.equal((await f.store.deleteFriend('a', { gid })).ok, false)
  assert.equal(f.calls.length, 1)
  finish({ data: { ok: true } })
  await first
  assert.equal(f.store.deletingFriends.value[11], undefined)
})

test('old deletion responses cannot mutate a switched or restored account', async () => {
  for (const restore of [false, true]) {
    const f = fixture()
    let finish
    f.api.post = () => new Promise((resolve) => {
      finish = resolve
    })
    const pending = f.store.deleteFriend('a', { gid: 11 })
    f.account.currentAccountId = 'b'
    f.store.clearFriendData()
    if (restore) {
      f.account.currentAccountId = 'a'
      f.store.clearFriendData()
    }
    f.store.friends.value = [{ gid: 11, name: '新列表' }]
    finish({ data: { ok: true } })
    await pending
    assert.equal(f.store.friends.value[0].name, '新列表')
    assert.equal(f.store.blacklist.value.length, 0)
  }
})

test('list and dog reads started before deletion cannot restore the deleted friend', async () => {
  for (const dogRead of [false, true]) {
    const f = fixture()
    let finish
    if (dogRead) {
      f.api.post = url => url.includes('fetch-dog-info')
        ? new Promise((resolve) => { finish = resolve })
        : Promise.resolve({ data: { ok: true } })
    }
    else {
      f.api.get = () => new Promise((resolve) => {
        finish = resolve
      })
    }
    const old = dogRead ? f.store.fetchFriendsDogInfo('a') : f.store.fetchFriends('a')
    await f.store.deleteFriend('a', { gid: 11 })
    finish({ data: { ok: true, data: [{ gid: 11 }, { gid: 22 }], friends: [{ gid: 11 }, { gid: 22 }] } })
    await old
    assert.deepEqual(Array.from(f.store.friends.value, friend => friend.gid), [22])
  }
})

test('old land reads cannot restore deleted details and still release other friends loading state', async () => {
  for (const friendId of ['11', '22']) {
    const f = fixture()
    let finish
    f.api.get = () => new Promise((resolve) => {
      finish = resolve
    })
    const old = f.store.fetchFriendLands('a', friendId)
    await f.store.deleteFriend('a', { gid: 11 })
    finish({ data: { ok: true, data: { lands: [{ id: 99 }] } } })
    await old
    assert.equal(f.store.friendLands.value[11], undefined)
    assert.equal(f.store.friendLandsLoading.value[11], undefined)
    assert.equal(f.store.friendLandsLoading.value[22], false)
  }
})

test('old blacklist and known-GID reads cannot overwrite successful deletion cleanup', async () => {
  for (const knownRead of [false, true]) {
    const f = fixture()
    let finish
    f.api.get = () => new Promise((resolve) => {
      finish = resolve
    })
    const old = knownRead ? f.store.fetchKnownFriendSettings('a') : f.store.fetchBlacklist('a')
    await f.store.deleteFriend('a', { gid: 11 })
    finish({ data: { ok: true, data: knownRead ? { knownFriendGids: [11, 22] } : [] } })
    await old
    assert.deepEqual(Array.from(f.store.knownFriendGids.value), [22])
    assert.equal(f.store.blacklist.value[0].gid, 11)
  }
})

function pageFixture(result = { ok: true }) {
  const ref = value => ({ value })
  const calls = []
  const account = { currentAccountId: ref('a'), currentAccount: ref({ platform: 'qq', running: true }) }
  const friends = Array.from({ length: 21 }, (_, i) => ({ gid: String(i + 1) }))
  const store = {
    friends: ref(friends),
    blacklist: ref([]),
    knownFriendGids: ref([]),
    friendLands: ref({}),
    deletingFriends: ref({}),
    async deleteFriend(...args) {
      calls.push(args)
      if (result.ok)
        store.friends.value = friends.slice(0, 20)
      return result
    },
  }
  const source = readFileSync(new URL('../src/views/Friends.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const exported = evaluate(`${source}\nexports.page = { handleDeleteFriend, showConfirm, expandedFriends, currentPage };`, {
    'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch() {} },
    'pinia': { storeToRefs: store => store },
    '@vueuse/core': { useIntervalFn() {} },
    '@/stores/account': { useAccountStore: () => account },
    '@/stores/friend': { useFriendStore: () => store },
    '@/stores/status': { useStatusStore: () => ({}) },
    '@/stores/toast': { useToastStore: () => ({ success: msg => calls.push(['success', msg]), error: msg => calls.push(['error', msg]) }) },
  })
  return { ...exported.page, calls }
}

test('page deletes on click without confirmation, closes details and fixes an empty last page', async () => {
  const f = pageFixture()
  f.expandedFriends.value.add('21')
  f.currentPage.value = 2
  let stopped = false
  await f.handleDeleteFriend({ gid: '21', name: '好友' }, { stopPropagation() {
    stopped = true
  } })
  assert.equal(stopped, true)
  assert.equal(f.showConfirm.value, false)
  assert.equal(f.calls[0][0], 'a')
  assert.equal(f.expandedFriends.value.has('21'), false)
  assert.equal(f.currentPage.value, 1)
  assert.equal(f.calls[1][0], 'success')
})

test('page failure preserves expanded friend and shows the reason without confirmation', async () => {
  const f = pageFixture({ ok: false, message: 'game rejected' })
  f.expandedFriends.value.add('21')
  await f.handleDeleteFriend({ gid: '21' }, { stopPropagation() {} })
  assert.equal(f.showConfirm.value, false)
  assert.equal(f.expandedFriends.value.has('21'), true)
  assert.deepEqual(f.calls.at(-1), ['error', 'game rejected'])
})
