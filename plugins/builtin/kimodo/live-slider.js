/** Kimodo's boards: a slider that calls `set(value)` as it is dragged and shows the value beside it. */
export function liveSlider(ui, label, min, max, step, value, set) {
  const element = ui.slider({
    k: label,
    min,
    max,
    step,
    value,
    onChange: changed => {
      set(changed)
      element.lastChild.textContent = String(changed)
    }
  })
  return element
}
