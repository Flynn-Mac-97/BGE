/**
 * See: curves drawn as a chart, into a plain RGBA buffer, so the same picture
 * comes out headless and in the browser.
 *
 * One chart overlays every curve given, each in its own colour, with a legend.
 * A sheet draws each curve in its own cell, named. Time runs left to right
 * over the longest curve (two rounds of a looping one); value runs up, over
 * whatever range the curves reach, with lines at 0 and 1. A curve of several
 * numbers draws one line for each; a colour curve (three numbers from 0 to 1)
 * also paints its colour in a strip under its plot.
 */
import { paintText } from './pixel-font.js'

/** Colours for the curves of one chart, in order. */
const PALETTE = [
  [88, 224, 122],
  [76, 201, 240],
  [244, 163, 64],
  [230, 90, 90],
  [190, 140, 255],
  [240, 220, 90],
  [230, 230, 230]
]

/** The line colours of a colour curve's channels: red, green, blue. */
const CHANNELS = [
  [235, 80, 80, 255],
  [80, 220, 110, 255],
  [80, 150, 255, 255]
]

const BACKGROUND = [13, 42, 51, 255]
const GRID = [30, 70, 80, 255]
const RULE = [80, 125, 135, 255]
const TEXT = [220, 235, 240, 255]

/** A chart of `curves` (`[{ label, curve }]`) overlaid: `{ width, height, pixels, legend }`. */
export function plotChart(curves, [width, height] = [720, 400]) {
  const canvas = blankCanvas(width, height)
  const legend = curves.map((entry, index) => ({ label: entry.label, colour: PALETTE[index % PALETTE.length] }))
  drawCell(canvas, { left: 40, top: 20, width: width - 60, height: height - 40 - 14 * legend.length }, curves, legend)
  legend.forEach((entry, index) => {
    const top = height - 14 * (legend.length - index) - 6
    fillRect(canvas, 40, top, 10, 8, [...entry.colour, 255])
    paintText(entry.label, 56, top, 2, (x, y) => paintAt(canvas, x, y, TEXT))
  })
  return { width, height, pixels: canvas.pixels, legend: legend.map(entry => entry.label) }
}

/** One named cell for each curve (`[{ label, curve }]`), `columns` across: `{ width, height, pixels, legend }`. */
export function plotSheet(curves, columns = 5, cell = [240, 170]) {
  const rows = Math.ceil(curves.length / columns)
  const canvas = blankCanvas(columns * cell[0], rows * cell[1])
  curves.forEach((entry, index) => {
    const left = (index % columns) * cell[0]
    const top = Math.floor(index / columns) * cell[1]
    paintText(entry.label, left + 10, top + 8, 2, (x, y) => paintAt(canvas, x, y, TEXT))
    const plot = { left: left + 12, top: top + 26, width: cell[0] - 24, height: cell[1] - 38 }
    drawCell(canvas, plot, [entry], [{ colour: PALETTE[0] }])
  })
  return { width: canvas.width, height: canvas.height, pixels: canvas.pixels, legend: curves.map(entry => entry.label) }
}

function blankCanvas(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(BACKGROUND, offset)
  return { width, height, pixels }
}

/** The grid, the rules at 0 and 1, and every curve's lines, inside one plot rectangle. */
function drawCell(canvas, plot, curves, legend) {
  const span = Math.max(...curves.map(({ curve }) => (curve.loop ? curve.duration * 2 : curve.duration))) || 1
  const sampled = curves.map(({ curve }) => sampledValues(curve, span, plot.width))
  const everything = sampled.flat(2)
  const low = Math.min(0, ...everything)
  const high = Math.max(1, ...everything)
  const rowOf = value => plot.top + plot.height - ((value - low) / (high - low)) * plot.height
  for (let quarter = 0; quarter <= 4; quarter++) {
    const x = Math.round(plot.left + (plot.width * quarter) / 4)
    line(canvas, [x, plot.top], [x, plot.top + plot.height], GRID)
  }
  for (const value of [0, 1]) line(canvas, [plot.left, rowOf(value)], [plot.left + plot.width, rowOf(value)], RULE)
  sampled.forEach((series, index) => {
    const colour = [...legend[index].colour, 255]
    const axes = series[0].length
    const isColour = isColourSeries(series)
    for (let axis = 0; axis < axes; axis++) {
      const shade = axes === 1 ? colour : axisColour(axis, isColour)
      const points = series.map((values, column) => [plot.left + column, rowOf(values[axis])])
      for (let step = 1; step < points.length; step++) thickLine(canvas, points[step - 1], points[step], shade)
    }
    if (isColour) colourStrip(canvas, plot, series)
  })
}

/** The line colour of one axis of a curve of several numbers: its channel for a colour curve. */
function axisColour(axis, isColour) {
  return isColour ? CHANNELS[axis] : [...PALETTE[axis % PALETTE.length], 255]
}

/** A curve's values at one sample per column, each as a list of numbers. */
function sampledValues(curve, span, columns) {
  return Array.from({ length: columns + 1 }, (unused, column) => [curve.valueAt((column / columns) * span)].flat())
}

const isColourSeries = series => series[0].length === 3 && series.flat().every(value => value >= 0 && value <= 1)

/** The colour a colour curve passes through, in a strip along the bottom of its plot. */
function colourStrip(canvas, plot, series) {
  series.forEach((values, column) => {
    const colour = [...values.map(value => Math.round(value * 255)), 255]
    for (let row = 0; row < 10; row++) paintAt(canvas, plot.left + column, plot.top + plot.height - 10 + row, colour)
  })
}

function paintAt(canvas, x, y, colour) {
  const column = Math.round(x)
  const row = Math.round(y)
  if (column < 0 || row < 0 || column >= canvas.width || row >= canvas.height) return
  canvas.pixels.set(colour, (row * canvas.width + column) * 4)
}

function fillRect(canvas, left, top, width, height, colour) {
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) paintAt(canvas, left + column, top + row, colour)
}

/** A one-pixel line, stepped along its longer side. */
function line(canvas, [fromX, fromY], [endX, endY], colour) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(endX - fromX), Math.abs(endY - fromY))))
  for (let step = 0; step <= steps; step++) {
    paintAt(canvas, fromX + ((endX - fromX) * step) / steps, fromY + ((endY - fromY) * step) / steps, colour)
  }
}

/** A line two pixels wide, so a curve reads over the grid. */
function thickLine(canvas, from, end, colour) {
  line(canvas, from, end, colour)
  line(canvas, [from[0], from[1] + 1], [end[0], end[1] + 1], colour)
}
