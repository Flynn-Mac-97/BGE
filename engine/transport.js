// The packaged editor and Vite use the same named engine messages.
let connection

export function engineTransport(development) {
  if (development) return development
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return null
  if (connection) return connection
  const listeners = new Map()
  let socket
  const emit = (name, data) => {
    for (const callback of listeners.get(name) || []) callback(data)
  }
  const connect = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/engine-events`)
    socket.onopen = () => emit('vite:ws:connect')
    socket.onmessage = event => {
      try { const message = JSON.parse(event.data); emit(message.event, message.data) } catch { /* ignore invalid messages */ }
    }
    socket.onclose = () => {
      emit('vite:ws:disconnect')
      setTimeout(connect, 1000)
    }
  }
  connection = {
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
    send(event, data) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, data }))
    }
  }
  connect()
  return connection
}
