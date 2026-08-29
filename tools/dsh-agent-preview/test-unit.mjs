// Quick unit harness for dsh-agent-preview: mock ctx with agents, session
// events, and a commands registry; verify the /agents snapshot renders.
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/james/.dsh/profiles/web/cordis.yml');
const resolved = req.resolve('dsh-agent-preview');
const mod = await import(pathToFileURL(resolved).href);

const listeners = new Map();
const on = (event, fn) => {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
};
const emit = (event, ...args) => {
  for (const fn of listeners.get(event) ?? []) fn(...args);
};

let registered;
const commands = {
  register: (def) => { registered = def; },
};

const rootAgent = {
  id: 'session-root-123',
  status: 'running',
  options: { model: 'deepseek-v4-flash', provider: 'deepseek-official' },
};
const childAgent = {
  id: 'session-child-456',
  status: 'idle',
  options: { model: 'deepseek-v4-flash', provider: 'deepseek-official' },
};
const agents = {
  list: () => [rootAgent, childAgent],
};

const ctx = {
  on,
  commands,
  agents,
  get: (key) => (key === 'agents' ? agents : key === 'subagents' ? undefined : undefined),
  logger: { warn: (...a) => console.log('[warn]', ...a) },
};

mod.apply(ctx);

// Simulate the root agent receiving a task and working through it.
emit('agent/created', { agent: rootAgent });
emit('agent/created', { agent: childAgent });
emit('session/event', {
  id: rootAgent.id,
}, {
  type: 'user/message',
  data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Refactor the render pipeline and report back' }] },
});
emit('session/event', { id: rootAgent.id }, { type: 'turn/start', data: { turn: 1 } });
emit('session/event', { id: rootAgent.id }, {
  type: 'tool/call',
  data: { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: { command: 'git status --short' } },
});
emit('session/event', { id: rootAgent.id }, {
  type: 'assistant/message',
  data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'I updated engine/render.js' }] } },
});
emit('session/event', { id: childAgent.id }, {
  type: 'user/message',
  data: { id: 'm2', role: 'user', content: [{ type: 'text', text: 'Audit the test suite' }] },
});

// Invoke the command handler.
const invocation = { agent: rootAgent, rawInput: '', attachments: [], signal: new AbortController().signal };
const result = await registered.handler(invocation);
console.log('--- /agents snapshot ---');
console.log(result.text);
console.log('--- kind:', result.kind);

// Assertions
const text = result.text;
if (!text.includes('session-root-123')) throw new Error('root agent missing');
if (!text.includes('session-child-456')) throw new Error('child agent missing');
if (!text.includes('render pipeline')) throw new Error('root task missing');
if (!text.includes('tool pwsh git status')) throw new Error('tool activity missing');
if (!text.includes('deepseek-v4-flash')) throw new Error('model missing');
if (!text.includes('2 live')) throw new Error('count missing');
console.log('--- ALL ASSERTIONS PASSED');
