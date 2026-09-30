# Game components

A component the kit has no function for is one HTML file in the game:
`assets/ui/components/<name>.html`. Game UI reads every one when a level
loads and again when one changes, adds its CSS to the sheet every panel
adopts, and draws it with:

```js
context.gameUi.show('quests', { isInteractive: true,
  html: () => kit.stack(offers.map(offer => context.gameUi.component('quest-card', { title: offer.title, reward: offer.reward }))),
  on: { 'accept-quest': title => accept(title) } })
```

## The file

```html
<!--
about: A quest offer: where it is, what it pays, and a button to take it.
props:
  title: The Drowned Relay
  reward: 250
  tier: standard | urgent | elite
-->
<article class="quest-card" data-tier="{{tier}}" aria-label="Quest: {{title}}">
  <h3>{{title}}</h3> <b>{{reward}}</b> scrip
  <button class="ui-button" ui-action="accept-quest" ui-value="{{title}}">Accept</button>
</article>
<style> .quest-card { border-left: 3px solid var(--ui-accent); } </style>
```

- The name is the file name: lower case letters, digits and dashes.
- `about:` is one sentence. The UI kit panel and `uikit.list` show it.
- `props:` lists each prop and its default, indented. `a | b | c` makes a choice whose default is the first.
- `{{prop}}` is text, escaped. `{{{prop}}}` is HTML, for children made by other kit calls or components.
- `ui-action="name"` on any element makes it a control that raises `name`, like `kit.target`; `ui-value` is the value the handler gets. On anything but a `<button>` it also adds `role="button"` and `tabindex="0"`.
- `<style>` is plain CSS. Write it against the `--ui-*` tokens so the game's theme recolours it. The theme comes after it, so `theme.css` can restyle a component.
- A prop not given takes its default; a prop with no default is empty.

## Accessible by default

- Put the words a screen reader should say in the markup: text in each control, or `aria-label` when a control shows only a glyph or picture.
- Give a decorative glyph `aria-hidden="true"`, an `<img>` an `alt`.
- `uikit.audit` checks every component and the theme's contrast; `uikit.get` returns one component's `findings`.
