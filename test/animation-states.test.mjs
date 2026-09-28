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
