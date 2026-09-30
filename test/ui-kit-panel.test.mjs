/**
 * UI Kit: game components as HTML files, the catalogue the gallery and the
 * commands share, element CSS kept in the theme, and the accessibility audit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { kit } from '../plugins/builtin/game-ui/components.js'
import { BASE_CSS } from '../plugins/builtin/game-ui/base-css.js'
import { DEFAULT_TOKENS } from '../plugins/builtin/game-ui/theme.js'
import { componentTemplate, parseComponent, readComponents, renderComponent } from '../plugins/builtin/game-ui/project-components.js'
import { auditHtml, auditTokens, contrastOf } from '../plugins/builtin/ui-kit/audit.js'
import { catalogueOf, defaultsOf, sourceOf } from '../plugins/builtin/ui-kit/catalogue.js'
import { blockOf, rulesOf, withBlock } from '../plugins/builtin/ui-kit/element-css.js'
import { galleryHtml } from '../plugins/builtin/ui-kit/gallery.js'
import panelUiKit from '../plugins/builtin/panel-ui-kit.js'

const QUEST_CARD = `<!--
about: A quest offer.
props:
  title: The Lost Crown
  reward: 250
  tone: accent | good | danger
-->
<article class="quest-card" data-tone="{{tone}}"><h3>{{title}}</h3>{{{extra}}}<button ui-action="accept" ui-value="{{title}}">Accept</button></article>
<style>.quest-card { border: 1px solid var(--ui-edge) }</style>`

test('a component file gives its about, props with defaults and choices, markup and CSS', () => {
  const component = parseComponent('quest-card', QUEST_CARD)
  assert.equal(component.about, 'A quest offer.')
  assert.deepEqual(component.props.map(prop => [prop.key, prop.kind, prop.value]), [['title', 'text', 'The Lost Crown'], ['reward', 'text', '250'], ['tone', 'choice', 'accent']])
  assert.deepEqual(component.props[2].choices, ['accent', 'good', 'danger'])
  assert.equal(component.css, '.quest-card { border: 1px solid var(--ui-edge) }')
  assert.equal(component.template.includes('<style>'), false)
})

test('props fill as escaped text, triple braces as HTML, and ui-action becomes a kit control', () => {
  const html = renderComponent(parseComponent('quest-card', QUEST_CARD), { title: '<Crown>', extra: '<i>new</i>' })
  assert.ok(html.includes('<h3>&lt;Crown&gt;</h3>'), 'text is escaped')
  assert.ok(html.includes('<i>new</i>'), 'triple braces are HTML')
  assert.ok(html.includes('data-tone="accent"'), 'an unset prop takes its default')
  assert.match(html, /<button data-ui-control="target" data-ui="accept" data-action="accept" data-trigger="click" data-value="&lt;Crown&gt;">/)
  const plain = renderComponent(parseComponent('tag', '<div ui-action="open">Open</div>'))
  assert.match(plain, /role="button" tabindex="0"/, 'a non-button control is reachable by keyboard')
})

test('the game reads every component file under assets/ui/components', async () => {
  const files = {
    'assets/ui/components/quest-card.html': QUEST_CARD,
    'assets/ui/components/Bad Name.html': '<p>skipped</p>',
    'assets/ui/components/nested/deep.html': '<p>skipped</p>',
    'assets/ui/theme.css': ''
  }
  const byName = await readComponents({ tree: async () => Object.keys(files).map(path => ({ path })), read: async path => files[path] })
  assert.deepEqual([...byName.keys()], ['quest-card'])
})

test('the new-component template is a working component with no findings', () => {
  const component = parseComponent('reward-card', componentTemplate('reward-card'))
  assert.deepEqual(auditHtml(renderComponent(component)), [])
  assert.ok(component.css.includes('.reward-card'))
})

test('every catalogue entry renders, prints its code, and passes the audit', () => {
  const entries = catalogueOf(kit, [parseComponent('quest-card', QUEST_CARD)])
  assert.equal(entries[0].kind, 'game', 'the game components come first')
  for (const entry of entries) {
    const html = entry.render(defaultsOf(entry))
    assert.ok(html.length > 0, `${entry.id} has markup`)
    assert.deepEqual(auditHtml(html), [], `${entry.id} has no accessibility findings`)
    if (entry.kind === 'kit') {
      assert.match(entry.code(defaultsOf(entry)), /^kit\.\w+\(/, `${entry.id} prints a kit call`)
      assert.ok(entry.classes.some(name => html.includes(name)), `${entry.id} draws a class it declares`)
      assert.ok(rulesOf(BASE_CSS, entry.classes).length > 0, `${entry.id} has kit rules to start from`)
    }
  }
})

test('code is printed as a game writes it', () => {
  assert.equal(sourceOf({ label: "It's", count: 3, gone: undefined, list: ['a'] }), "{ label: 'It\\'s', count: 3, list: ['a'] }")
  const button = catalogueOf(kit, []).find(entry => entry.id === 'button')
  assert.equal(button.code({ label: 'Go', kind: 'primary', isDisabled: false }), "kit.button('Go', { action: 'deploy', kind: 'primary' })")
})

test('the gallery groups every entry and marks the picked one', () => {
  const entries = catalogueOf(kit, [parseComponent('quest-card', QUEST_CARD)])
  const html = galleryHtml(entries, { selectedId: 'bar' })
  assert.ok(html.indexOf('This game') < html.indexOf('Controls'), 'the game group is first')
  assert.equal((html.match(/class="kit-tile"/g) ?? []).length, entries.length)
  assert.match(html, /data-pick="bar" aria-pressed="true"/)
})

test('a kit element keeps its CSS in the theme between marks, and empty CSS removes it', () => {
  const theme = ':root { --ui-accent: #f06 }\n'
  const both = withBlock(withBlock(theme, 'button', '.ui-button { border-radius: 0 }'), 'badge', '.ui-badge { color: red }')
  assert.equal(blockOf(both, 'button'), '.ui-button { border-radius: 0 }')
  assert.equal(blockOf(both, 'badge'), '.ui-badge { color: red }')
  assert.ok(both.startsWith(theme.trim()), 'the game keeps its own rules')
  assert.equal(withBlock(both, 'button', ' ').includes('ui-kit:button'), false)
})

test('contrast follows WCAG and the default theme passes AA over dark and light worlds', () => {
  assert.equal(contrastOf('#000000', '#ffffff'), 21)
  assert.equal(contrastOf('#777777', '#777777'), 1)
  assert.deepEqual(auditTokens(DEFAULT_TOKENS, '#000000'), [])
  assert.deepEqual(auditTokens(DEFAULT_TOKENS, '#ffffff'), [])
  const [finding] = auditTokens({ ...DEFAULT_TOKENS, quiet: 'rgba(237, 232, 220, 0.2)' })
  assert.equal(finding.rule, 'contrast')
})

test('the audit names controls with no name, controls the keyboard cannot reach, and images with no alt', () => {
  const rules = auditHtml('<div data-ui-control="target" data-action="x"></div><button><span aria-hidden="true">★</span></button><img src="a.png">').map(finding => finding.rule)
  assert.deepEqual(rules.sort(), ['alt', 'keyboard', 'name', 'name'])
  assert.deepEqual(auditHtml('<button aria-label="Favourite"><span aria-hidden="true">★</span></button>'), [])
})

test('the commands list, read, create and save components through the game files', async () => {
  const files = { 'assets/ui/theme.css': ':root { --ui-accent: #f06 }', 'assets/ui/components/quest-card.html': QUEST_CARD }
  let components = []
  const context = {
    files: {
      read: async path => { if (!(path in files)) throw new Error('missing'); return files[path] },
      write: async (path, text) => { files[path] = text },
      tree: async () => Object.keys(files).map(path => ({ path }))
    },
    gameUi: {
      kit,
      theme: { sheet: css => BASE_CSS + css, tokens: () => DEFAULT_TOKENS },
      components: { list: () => components, load: async () => { components = [...(await readComponents(context.files)).values()] } }
    }
  }
  const run = (id, argument) => panelUiKit.commands.find(command => command.id === id).run(context, argument)

  const list = await run('uikit.list')
  assert.deepEqual(list[0], { id: 'quest-card', kind: 'game', group: 'This game', title: 'quest-card', about: 'A quest offer.', file: 'assets/ui/components/quest-card.html', props: { title: 'The Lost Crown', reward: '250', tone: 'accent' } })

  const card = await run('uikit.get', { id: 'quest-card', props: { tone: 'good' } })
  assert.equal(card.source, QUEST_CARD)
  assert.equal(card.code, "context.gameUi.component('quest-card', { title: 'The Lost Crown', reward: '250', tone: 'good' })")
  assert.ok(card.html.includes('data-tone="good"'))

  const button = await run('uikit.get', 'button')
  assert.equal(button.isSaved, false)
  assert.ok(button.css.includes('.ui-button {'))
  await run('uikit.set', { id: 'button', css: '.ui-button { color: red }' })
  assert.deepEqual([(await run('uikit.get', 'button')).css, files['assets/ui/theme.css'].includes('--ui-accent: #f06')], ['.ui-button { color: red }', true])
  await assert.rejects(run('uikit.set', { id: 'quest-card', css: 'x' }), /edit assets\/ui\/components\/quest-card.html/)

  const made = await run('uikit.new', { id: 'reward-card', about: 'A reward.' })
  assert.equal(made.file, 'assets/ui/components/reward-card.html')
  assert.ok(files[made.file].includes('about: A reward.'))
  await assert.rejects(run('uikit.new', 'reward-card'), /already a component/)
  await assert.rejects(run('uikit.new', 'Bad Name'), /not a component name/)
  await assert.rejects(run('uikit.get', 'nope'), /uikit.list names them/)

  assert.deepEqual(await run('uikit.audit'), { ok: true, theme: [], components: [] })
})
