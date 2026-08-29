/**
 * dsh-agent-preview — live preview of agents and what they are doing.
 *
 * A host-plane plugin that registers the human-facing `/agents` command in the
 * web GUI. It tracks a live per-session activity map from the `session/event`
 * firehose (task text, tool calls, assistant text, turn boundaries) plus the
 * `agent/created` / `agent/disposed` lifecycle, then renders one snapshot:
 * every live agent with status, model, role/label, parent, current task and
 * last activity.
 *
 * Events consumed (payload shapes from the shipped harness):
 *   - session/event (session, event): user/message, tool/call, assistant/message,
 *     turn/start, turn/end
 *   - agent/created { agent }, agent/disposed { agent }
 *
 * Status is read live from `ctx.agents` at render time (`agent.status`), so no
 * scoped agent/status subscription is needed.
 *
 * Optional enrichment: when ctx.subagents (+ sessionProjections) is mounted,
 * each agent row gains its durable label, mode, parent, and depth via
 * listDescendants(); otherwise the flat live-registry view is rendered.
 *
 * @module dsh-agent-preview
 */
export const name = 'agent-preview';
export const inject = ['commands', 'agents'];

const TASK_MAX = 160;
const TOOL_ARGS_MAX = 80;
const TEXT_MAX = 120;

/** Extract the plain-text join of a message's content blocks. */
function textOf(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compact single-line preview of a tool call. */
function toolPreview(name, args) {
  let preview = String(name ?? 'tool');
  if (args !== undefined && args !== null) {
    let text;
    if (typeof args === 'string') {
      text = args;
    } else if (typeof args === 'object' && typeof args.command === 'string') {
      // Shell tools carry the command in a `command` field — show that directly.
      text = args.command;
    } else {
      try {
        text = JSON.stringify(args);
      } catch {
        text = String(args);
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 0) preview += ` ${text}`;
  }
  return preview.length > TOOL_ARGS_MAX + 40 ? `${preview.slice(0, TOOL_ARGS_MAX)}…` : preview;
}

/** Truncate a single-line string to a maximum length. */
function clip(text, max) {
  const single = String(text ?? '').replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/** Age helper: render a timestamp as a short relative age. */
function ageOf(timestampMs, nowMs) {
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

/**
 * The plugin's live projection: one activity row per session id.
 * Pure data; the command handler reads it synchronously.
 */
function createActivityMap() {
  const rows = new Map();
  const ensure = (sessionId) => {
    let row = rows.get(sessionId);
    if (row === undefined) {
      row = {
        task: '',
        lastTool: '',
        lastAssistant: '',
        turnOpen: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      rows.set(sessionId, row);
    }
    return row;
  };
  /** Fold one committed session event into the projection. */
  const fold = (sessionId, event) => {
    const row = ensure(sessionId);
    row.updatedAt = Date.now();
    switch (event.type) {
      case 'user/message': {
        const text = textOf(event.data);
        if (text.length > 0) row.task = text;
        break;
      }
      case 'assistant/message': {
        const text = textOf(event.data?.message);
        if (text.length > 0) row.lastAssistant = text;
        break;
      }
      case 'tool/call': {
        row.lastTool = toolPreview(event.data?.name, event.data?.arguments);
        break;
      }
      case 'turn/start':
        row.turnOpen = true;
        break;
      case 'turn/end':
        row.turnOpen = false;
        break;
      default:
        break;
    }
  };
  return { rows, ensure, fold };
}

/** Render one agent row as compact display text. */
function renderRow(agentId, activity, status, model, catalogRow, nowMs) {
  const label = catalogRow?.label;
  const mode = catalogRow?.mode;
  const depth = catalogRow?.depth;
  const running = status === 'running' || activity.turnOpen;
  const icon = running ? '●' : '○';
  const statusText = running ? 'running' : 'idle';
  const modelText = model ? ` ${model}` : '';
  const labelText = label ? ` "${label}"` : '';
  const modeText = mode && mode !== 'one-shot' ? ` [${mode}]` : '';
  const indent = '    '.repeat(Math.max(0, (depth ?? 1) - 1));
  const lines = [
    `${indent}${icon} ${agentId}${labelText}${modeText} — ${statusText}${modelText}`,
  ];
  const task = clip(activity.task, TASK_MAX);
  if (task.length > 0) lines.push(`${indent}    task:  ${task}`);
  const doing = [];
  if (activity.lastTool.length > 0) doing.push(`tool ${activity.lastTool}`);
  if (running && activity.lastTool.length === 0 && activity.lastAssistant.length === 0) {
    doing.push('writing…');
  }
  if (doing.length > 0) lines.push(`${indent}    doing: ${doing.join(' · ')}`);
  const last = clip(activity.lastAssistant, TEXT_MAX);
  if (last.length > 0) lines.push(`${indent}    last:  ${last}`);
  const age = ageOf(activity.updatedAt, nowMs);
  lines.push(`${indent}    age:   ${age}`);
  return lines.join('\n');
}

/**
 * Collect the subagent catalog rows for the command's agent, best-effort:
 * returns a Map from session id to the catalog row, or undefined when the
 * subagent service or projection registry is unavailable.
 */
async function catalogOf(ctx, rootAgentId, signal) {
  const subagents = ctx.get('subagents');
  if (subagents === undefined || typeof subagents.listDescendants !== 'function') return undefined;
  try {
    const entries = await subagents.listDescendants(rootAgentId, signal);
    const map = new Map();
    for (const entry of entries) {
      if (entry && entry.kind === 'child' && typeof entry.id === 'string') {
        map.set(entry.id, entry);
      }
    }
    return map;
  } catch (error) {
    ctx.logger?.warn?.(`agent-preview: subagent catalog unavailable: ${String(error?.message ?? error)}`);
    return undefined;
  }
}

/** Render the full /agents snapshot for one invoking agent. */
async function renderSnapshot(ctx, activity, invocation) {
  const agents = ctx.get('agents');
  const nowMs = Date.now();
  const live = agents?.list?.() ?? [];
  const catalog = await catalogOf(ctx, invocation.agent.id, invocation.signal);
  const rows = [];
  for (const agent of live) {
    const id = agent.id;
    const activityRow = activity.rows.get(id) ?? {
      task: '', lastTool: '', lastAssistant: '', turnOpen: false,
      createdAt: nowMs, updatedAt: nowMs,
    };
    const catalogRow = catalog?.get(id);
    const status = typeof agent.status === 'string' ? agent.status : 'idle';
    const model = agent.options?.model;
    rows.push(renderRow(id, activityRow, status, model, catalogRow, nowMs));
  }
  const runningCount = live.filter((agent) => agent.status === 'running').length;
  const header = `Agents: ${live.length} live (${runningCount} running)`;
  if (rows.length === 0) return `${header}\n(no live agents)`;
  return `${header}\n\n${rows.join('\n\n')}`;
}

/** The /agents command handler. */
function handleAgents(ctx, activity, invocation) {
  return renderSnapshot(ctx, activity, invocation).then(
    (text) => ({ kind: 'success', text }),
    (error) => ({
      kind: 'error',
      text: `agent-preview: ${error instanceof Error ? error.message : String(error)}`,
    }),
  );
}

/**
 * Mount the plugin: register /agents and start folding session events.
 * @param ctx - cordis context carrying commands and agents.
 */
export function apply(ctx) {
  const activity = createActivityMap();
  ctx.on('session/event', (session, event) => {
    if (!session || !session.id) return;
    activity.fold(session.id, event);
  });
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.id) activity.ensure(agent.id);
  });
  ctx.on('agent/disposed', ({ agent }) => {
    if (agent?.id) activity.rows.delete(agent.id);
  });

  ctx.commands.register({
    name: 'agents',
    description: 'show live agents and what they are doing',
    input: { hint: 'no arguments — run /agents to preview' },
    handler: (invocation) => handleAgents(ctx, activity, invocation),
  });
}
