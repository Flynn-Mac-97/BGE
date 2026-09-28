#!/usr/bin/env node
/**
 * Animation States' machine. A transition that fires in the wrong order, or a
 * once state cut short, plays the wrong clip and nothing reports it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { machineProblems, nextState, pickClip } from '../plugins/builtin/animation-states/machine.js'

const MACHINE = {
  start: 'idle',
  states: {
    idle: { clips: ['idle-a', 'idle-b', 'idle-c'] },
    walk: { clips: ['walk-a'] },
    run: { clips: ['run-a'] },
    'turn-left': { clips: ['turn-a'], then: 'idle' }
  },
  transitions: [
    { to: 'turn-left', from: ['idle'], when: { turning: 'left' } },
    { to: 'run', when: { speed: { above: 3 } } },
    { to: 'walk', when: { speed: { above: 0.2 } } },
    { to: 'idle' }
  ]
}

test('the first transition that matches names the state, and naming the state it is in keeps it', () => {
  assert.equal(nextState(MACHINE, 'idle', { speed: 5 }), 'run')
  assert.equal(nextState(MACHINE, 'run', { speed: 5 }), 'run', 'a lower transition does not pull it out')
  assert.equal(nextState(MACHINE, 'run', { speed: 1 }), 'walk')
  assert.equal(nextState(MACHINE, 'walk', { speed: 0 }), 'idle')
})

test('a transition with from applies only in those states', () => {
  assert.equal(nextState(MACHINE, 'idle', { turning: 'left', speed: 0 }), 'turn-left')
  assert.equal(nextState(MACHINE, 'walk', { turning: 'left', speed: 1 }), 'walk')
})

test('a once state is not interrupted until its clip ends, then goes on', () => {
  assert.equal(nextState(MACHINE, 'turn-left', { speed: 5, done: false }), 'turn-left')
  assert.equal(nextState(MACHINE, 'turn-left', { speed: 5, done: true }), 'idle')
})

test('a state picks one of its clips by the random number', () => {
  assert.equal(pickClip(MACHINE, 'idle', 0), 'idle-a')
  assert.equal(pickClip(MACHINE, 'idle', 0.5), 'idle-b')
  assert.equal(pickClip(MACHINE, 'idle', 0.999), 'idle-c')
})

test('a missing clip or state is named', () => {
  const clips = { 'idle-a': 1, 'idle-b': 1, 'idle-c': 1, 'walk-a': 1, 'run-a': 1 }
  assert.deepEqual(machineProblems(MACHINE, clips), ['state "turn-left" plays "turn-a", which rig.clips does not declare'])
  assert.deepEqual(machineProblems({ ...MACHINE, transitions: [{ to: 'jump' }] }, { ...clips, 'turn-a': 1 }), [
    'a transition goes to "jump", which is not a state'
  ])
})

test('a scaffold gathers takes into states and wires the states it knows, in priority order', async () => {
  const { scaffoldGraph } = await import('../plugins/builtin/animation-states/scaffold.js')
  const { graph, unwired } = scaffoldGraph('motion/hero', ['take-base-walk-b', 'take-base-walk-a', 'take-base-idle-a', 'take-base-run-a', 'take-base-dance-a'])
  assert.deepEqual(graph.states.walk.clips, ['take-base-walk-a', 'take-base-walk-b'])
  assert.deepEqual(graph.transitions.map(transition => transition.to), ['run', 'walk', 'idle'])
  assert.equal(graph.start, 'idle')
  assert.deepEqual(unwired, ['dance'])
})

test('a report names states nothing reaches, missing files and transitions that never fire', async () => {
  const { graphReport } = await import('../plugins/builtin/animation-states/report.js')
  const machine = {
    start: 'idle',
    states: { idle: { clips: ['motion/hero/idle.json'] }, walk: { clips: ['motion/hero/walk.json'] }, dance: { clips: ['motion/hero/dance.json'] } },
    transitions: [{ to: 'idle' }, { to: 'walk', when: { moving: true } }]
  }
  const report = graphReport(machine, {}, new Set(['assets/motion/hero/idle.json', 'assets/motion/hero/walk.json']))
  assert.deepEqual(report.problems, [
    'state "dance": no file assets/motion/hero/dance.json',
    'state "dance" is never reached: no transition goes to it',
    'the transition to "walk" never fires: a transition above it always matches'
  ])
  assert.deepEqual(report.inputs, ['moving'])
})

test('sets lay their states over the graph, later sets winning, and give actions as clip files', async () => {
  const { actionOf, machineWith, upperBodyOf } = await import('../plugins/builtin/animation-states/graph.js')
  const graph = { folder: 'motion/hero', start: 'idle', states: { idle: { clips: ['idle-a'] } }, transitions: [] }
  const sword = { folder: 'motion/hero', states: { idle: { clips: ['guard-a'] } }, actions: { attack: { clips: ['slash-a'], mask: 'upper' } } }
  const shield = { folder: 'motion/shield', actions: { attack: { clips: ['bash-a'] } } }
  assert.deepEqual(machineWith(graph, []).states.idle.clips, ['motion/hero/idle-a.json'])
  assert.deepEqual(machineWith(graph, [sword]).states.idle.clips, ['motion/hero/guard-a.json'])
  assert.deepEqual(actionOf([sword, shield], 'attack').clips, ['motion/shield/bash-a.json'])
  assert.equal(actionOf([sword], 'block'), null)
  const skeleton = { nodes: { Hips: { parent: null }, Spine: { parent: 'Hips' }, Spine2: { parent: 'Spine' }, Arm: { parent: 'Spine2' }, Leg: { parent: 'Hips' } } }
  assert.deepEqual(upperBodyOf(skeleton, 'Spine2'), ['Spine', 'Spine2', 'Arm'])
})
