import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { computed, effectScope, nextTick, ref, watch } from 'vue';

// Exercise the actual component script with Vue reactivity and a controlled IPC boundary.
const source = await readFile(new URL('../src/ui/SearchView.vue', import.meta.url), 'utf8');
const setup = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm, '');
const script = ts.transpileModule(setup + '\nglobalThis.state = { begin, sites, query, scope, pages, running, status, notice };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const site = id => ({ id, name: id, enabled: true, adapter: 'sotvla' });
async function mount(t) {
  const lifecycle = effectScope(); t.after(() => lifecycle.stop());
  const calls = []; let mounted, listener, cancellations = 0;
  const api = {
    sites: async () => [site('a'), site('b')],
    onSearch: cb => { listener = cb; return () => {}; },
    search: async (...args) => { calls.push(args); return args[4]; },
    cancelSearch: async () => { cancellations++; }
  };
  const context = vm.createContext({ computed, ref, watch, crypto: { randomUUID }, window: { harbor: api },
    defineProps: () => ({ directory: 'C:/downloads', active: true }),
    onMounted: cb => { mounted = cb; }, onUnmounted: () => {} });
  lifecycle.run(() => vm.runInContext(script, context));
  await mounted(); await nextTick();
  return { state: context.state, calls, cancellations: () => cancellations,
    result(id, title, page = 1, requestId = calls.at(-1)[4]) {
      listener({ requestId, siteId: id, page, result: { siteId: id, hasMore: true, items: [{ id: title, title }] } });
    } };
}

for (const change of ['deleted', 'disabled', 'unadapted']) {
  test(`selected ${change} site is removed from the scope and pending state`, async t => {
    const { state: s, calls, result } = await mount(t);
    s.scope.value = ['a']; s.query.value = 'Alpha'; await s.begin();
    s.sites.value = change === 'deleted' ? [site('b')] : [
      { ...site('a'), ...(change === 'disabled' ? { enabled: false } : { adapter: 'none' }) }, site('b')
    ];
    await nextTick();
    assert.equal(s.scope.value.length, 0);
    assert.equal(s.running.value, false);
    result('a', 'late removed-site result');
    assert.equal(s.pages.value.a, undefined);
    await s.begin(); assert.deepEqual(Array.from(calls.at(-1)[1]), ['b']);
    result('b', 'Alpha'); assert.equal(s.running.value, false);
  });
}

test('an empty eligible set ends search and ignores the previous request result', async t => {
  const { state: s, calls, result, cancellations } = await mount(t);
  s.query.value = 'Alpha'; await s.begin(); const oldId = calls.at(-1)[4];
  s.sites.value = []; await nextTick(); await s.begin();
  assert.equal(calls.length, 1); assert.equal(s.running.value, false);
  assert.ok(cancellations() > 0); assert.match(s.notice.value, /至少一个/);
  result('a', 'late', 1, oldId); assert.equal(s.pages.value.a, undefined);
});

test('pagination and retry use the submitted keyword until a new search is submitted', async t => {
  const { state: s, calls, result } = await mount(t);
  s.scope.value = ['a']; s.query.value = 'Alpha'; await s.begin(); result('a', 'Alpha 1');
  s.query.value = 'Beta'; await s.begin('a', 2);
  assert.equal(calls.at(-1)[0], 'Alpha'); assert.equal(calls.at(-1)[2], 2);
  result('a', 'Alpha 2', 2); assert.equal(s.pages.value.a.items.length, 2);
  await s.begin('a'); assert.equal(calls.at(-1)[0], 'Alpha'); assert.equal(calls.at(-1)[2], 1);
  s.query.value = ''; await s.begin('a'); assert.equal(calls.length, 4);
  assert.equal(calls.at(-1)[0], 'Alpha');
  s.query.value = 'Beta'; await s.begin(); assert.equal(calls.at(-1)[0], 'Beta');
  assert.equal(s.pages.value.a, undefined); result('a', 'Beta 1');
  await s.begin('a', 2); assert.equal(calls.at(-1)[0], 'Beta'); result('a', 'Beta 2', 2);
  assert.deepEqual(Array.from(s.pages.value.a.items, item => item.title), ['Beta 1', 'Beta 2']);
});
