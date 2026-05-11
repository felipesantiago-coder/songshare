import Peer, { DataConnection, MediaConnection } from 'peerjs'

export const PEER_PREFIX = 'songshare-'

/**
 * Calcula offset de relógio e latência usando algoritmo de Cristian
 * @returns { clockOffset: number, rtt: number } - offset em ms para sincronizar, RTT em ms
 */
export function calculateClockSync(sentTime: number, receivedTime: number, serverTime: number): { clockOffset: number, rtt: number } {
  const rtt = receivedTime - sentTime
  const clockOffset = serverTime - (sentTime + rtt / 2)
  return { clockOffset, rtt }
}

/**
 * Agendar execução de comando com compensação de latência
 * @param executeAt - Timestamp absoluto quando o comando deve ser executado (em ms)
 * @param action - Ação a ser executada
 * @param minLeadTime - Tempo mínimo de antecedência para agendamento (padrão: 100ms)
 */
export function scheduleAction(executeAt: number, action: () => void, minLeadTime = 100): void {
  const now = Date.now()
  const delay = executeAt - now
  
  if (delay <= minLeadTime) {
    // Já passou ou está muito próximo → executa imediatamente
    action()
  } else {
    // Agenda para o futuro
    setTimeout(action, delay - minLeadTime)
  }
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

type Handler = (data?: any) => void

/**
 * PeerManager — Gerenciador de conexões P2P via PeerJS/WebRTC.
 *
 * O HOST cria um peer cujo ID contém o código da sala (songshare-ABC123).
 * Ouvintes conectam-se diretamente ao host usando esse ID.
 * Todas as mensagens fluem de host ↔ ouvinte via data channels WebRTC.
 *
 * Voice chat usa media calls (WebRTC audio) direto entre todos os peers.
 */
export class PeerManager {
  peer: Peer | null = null
  connections = new Map<string, DataConnection>() // remotePeerId → DataConnection
  mediaCalls = new Map<string, MediaConnection>() // remotePeerId → MediaConnection

  roomCode = ''
  username = ''
  userId = ''
  isHost = false

  private handlers = new Map<string, Set<Handler>>()
  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private _reconnectingToHost: string | null = null

  /* ── EventEmitter ─────────────────────────────── */

  on(event: string, handler: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler)
  }

  private emit(event: string, data?: any) {
    const set = this.handlers.get(event)
    if (!set) return
    set.forEach((h) => {
      try { h(data) } catch (e) { console.error(`[SongShare] Handler error (${event}):`, e) }
    })
  }

  /* ── Conexão ao servidor de sinalização ──────── */

  /** Cria peer com ID aleatório (usado ao montar o app). Retries automatically. */
  async connect(maxRetries = 2): Promise<void> {
    this.destroy()
    let lastError: any
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this._createPeer()
        return
      } catch (err) {
        lastError = err
        if (attempt < maxRetries) {
          console.warn(`[SongShare] Initial connection failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in 3s...`)
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }
    console.error('[SongShare] Failed to connect after all retries')
    throw lastError
  }

  /** Cria a instância PeerJS. */
  private _createPeer(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const peerId = id || generateId()

      this.peer = new Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        },
      })

      const timeout = setTimeout(() => {
        this.peer?.destroy()
        this.peer = null
        reject(new Error('Timeout ao conectar ao servidor de sinalização'))
      }, 15000)

      this.peer.on('open', (openedId) => {
        clearTimeout(timeout)
        this.stopReconnectLoop()
        // Emit 'connected' so the hook can update isConnected state
        // This fires on initial connection AND on reconnection after a drop
        this.emit('connected')

        // If we're a listener in a room and lost the DataConnection,
        // re-establish it now that signaling is back
        if (!this.isHost && this.roomCode && !this.connections.has(`${PEER_PREFIX}${this.roomCode}`)) {
          console.log('[SongShare] Signaling reconnected, re-establishing DataConnection to host...')
          this._attemptReconnectToHost(`${PEER_PREFIX}${this.roomCode}`)
        }

        resolve(openedId)
      })

      this.peer.on('connection', (conn) => this._handleIncoming(conn))

      // Handle incoming media calls (voice chat)
      this.peer.on('call', (mediaCall) => {
        this.emit('incoming-call', mediaCall)
      })

      this.peer.on('error', (err) => {
        clearTimeout(timeout)
        console.error('[SongShare] Peer error:', err.type || err)
        reject(err)
      })

      this.peer.on('disconnected', () => {
        this.emit('disconnected')
        this.startReconnectLoop()
      })
    })
  }

  /* ── Reconexão persistente ao servidor de sinalização ── */

  /** Start a periodic reconnect loop. Stops automatically on success or destroy. */
  private startReconnectLoop() {
    if (this.reconnectTimer) return
    console.log('[SongShare] Disconnected from signaling server, retrying...')

    // Try immediately
    if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
      try { this.peer.reconnect() } catch { /* noop */ }
    }

    // Then retry every 5 seconds until reconnected or destroyed
    this.reconnectTimer = setInterval(() => {
      if (!this.peer || this.peer.destroyed) {
        this.stopReconnectLoop()
        return
      }
      if (!this.peer.disconnected) {
        this.stopReconnectLoop()
        return
      }
      try { this.peer.reconnect() } catch { /* noop */ }
    }, 5000)
  }

  /** Stop the reconnect loop. */
  private stopReconnectLoop() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /* ── Criar sala (host) ────────────────────────── */

  async createRoom(username: string): Promise<string> {
    this.username = username
    this.userId = generateId()
    this.isHost = true
    this.connections.clear()

    let code: string | undefined
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = generateRoomCode()
      try {
        await this._createPeer(`${PEER_PREFIX}${candidate}`)
        code = candidate
        break
      } catch (err: any) {
        // ID já em uso → tentar outro
        if (err.type === 'unavailable-id' || String(err).includes('ID is taken')) continue
        throw err
      }
    }

    if (!code) throw new Error('Não foi possível criar uma sala. Tente novamente.')
    this.roomCode = code
    this.emit('room-created', { code })
    return code
  }

  /* ── Entrar na sala (ouvinte) ─────────────────── */

  async joinRoom(code: string, username: string): Promise<void> {
    this.username = username
    this.userId = generateId()
    this.isHost = false
    this.roomCode = code.toUpperCase()
    this.connections.clear()

    // Garantir que o peer local existe e está conectado ao signaling
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
      await this._createPeer()
    }

    const hostPeerId = `${PEER_PREFIX}${this.roomCode}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Nao foi possivel conectar. Verifique o codigo e tente novamente.'))
      }, 15000)

      const conn = this.peer!.connect(hostPeerId, { reliable: true })

      conn.on('open', () => {
        clearTimeout(timeout)
        this.connections.set(conn.peer, conn)
        this._wireConnection(conn)

        // Enviar pedido de entrada
        conn.send({ type: 'join-request', username: this.username, userId: this.userId })
        resolve()
      })

      conn.on('error', () => {
        clearTimeout(timeout)
        reject(new Error('Não foi possível conectar à sala. Verifique o código.'))
      })
    })
  }

  /* ── Conexões ──────────────────────────────────── */

  private _handleIncoming(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn)
      this._wireConnection(conn)
    })
  }

  /** Registra handlers de data/close/error numa conexão. */
  private _wireConnection(conn: DataConnection) {
    conn.on('data', (data) => this._route(data, conn.peer))

    conn.on('close', () => {
      const peerId = conn.peer
      this.connections.delete(peerId)

      if (!this.isHost) {
        // Listener lost connection to host — attempt reconnection
        this._attemptReconnectToHost(peerId)
      } else {
        // Host: a listener's connection dropped — notify others and clean up
        this.emit('listener-connection-lost', { peerId })
      }
    })

    conn.on('error', (err) => {
      console.error('[SongShare] Conn error:', err)
    })
  }

  /** Listener: try to re-establish DataConnection to host. Retries persistently. */
  private _attemptReconnectToHost(hostPeerId: string) {
    // Don't try if we're no longer in a room
    if (!this.roomCode || !this.peer || this.peer.destroyed) return

    // Don't start a second reconnect if one is already running for this host
    if (this._reconnectingToHost === hostPeerId) return
    this._reconnectingToHost = hostPeerId

    console.warn('[SongShare] DataConnection to host lost, reconnecting...')

    let attempt = 0

    const tryConnect = () => {
      // Stop conditions: left room, destroyed, or already reconnected
      if (!this.roomCode || !this.peer || this.peer.destroyed) {
        this._reconnectingToHost = null
        return
      }
      if (this.connections.has(hostPeerId)) {
        console.log('[SongShare] DataConnection to host restored')
        this._reconnectingToHost = null
        return
      }
      // If signaling server itself is disconnected, wait for it to come back
      // (the signaling reconnect loop will emit 'connected', which triggers _tryReconnectDataAfterSignaling)
      if (this.peer.disconnected) {
        attempt++
        const delay = Math.min(5000 + attempt * 1000, 15000) // 5s–15s
        console.log(`[SongShare] Signaling disconnected, waiting... (next try in ${delay / 1000}s)`)
        setTimeout(tryConnect, delay)
        return
      }

      attempt++
      const backoff = Math.min(2000 * Math.pow(1.3, attempt - 1), 15000) // 2s–15s exponential

      console.log(`[SongShare] DataConnection reconnect attempt ${attempt} (backoff ${Math.round(backoff / 1000)}s)`)

      try {
        const newConn = this.peer!.connect(hostPeerId, { reliable: true })

        const timeout = setTimeout(() => {
          try { newConn.close() } catch { /* noop */ }
          setTimeout(tryConnect, backoff)
        }, 10000)

        newConn.on('open', () => {
          clearTimeout(timeout)
          this.connections.set(newConn.peer, newConn)
          this._wireConnection(newConn)
          // Re-announce presence to get back in sync
          newConn.send({
            type: 'join-request',
            username: this.username,
            userId: this.userId,
            reconnecting: true,
          })
          console.log('[SongShare] Reconnected to host successfully')
          this._reconnectingToHost = null
        })

        newConn.on('error', () => {
          clearTimeout(timeout)
          setTimeout(tryConnect, backoff)
        })

        newConn.on('close', () => {
          clearTimeout(timeout)
        })
      } catch (e) {
        setTimeout(tryConnect, backoff)
      }
    }

    setTimeout(tryConnect, 1500)
  }

  /* ── Roteamento de mensagens ──────────────────── */

  private _route(data: any, senderPeerId: string) {
    if (!data || typeof data !== 'object' || !data.type) return

    switch (data.type) {
      case 'join-request':
        if (this.isHost) {
          this.emit('join-request', { ...data, peerId: senderPeerId })
        }
        break
      case 'request-track-data':
        if (this.isHost) {
          this.emit('request-track-data', { ...data, senderPeerId })
        }
        break
      case 'user-left-request':
        if (this.isHost) {
          this.emit('user-left-request', { ...data, peerId: senderPeerId })
        }
        break
      // Guest playback control requests — only the host should handle these
      case 'request-play':
      case 'request-pause':
      case 'request-seek':
      case 'request-next':
      case 'request-previous':
      case 'change-track':
        if (this.isHost) {
          this.emit(data.type, { ...data, senderPeerId })
        }
        break
      default: {
        // Strip event type to prevent polluting room state
        const { type: _eventType, ...payload } = data
        this.emit(_eventType, payload)
      }
    }
  }

  /* ── Envio de mensagens ───────────────────────── */

  sendTo(peerId: string, data: any) {
    const conn = this.connections.get(peerId)
    if (conn?.open) {
      try { conn.send(data) } catch (e) { console.error('[SongShare] sendTo error:', e) }
    }
  }

  broadcast(data: any, excludePeerId?: string) {
    this.connections.forEach((conn, peerId) => {
      if (peerId !== excludePeerId && conn.open) {
        try { conn.send(data) } catch (e) { console.error('[SongShare] broadcast error:', e) }
      }
    })
  }

  /**
   * Send binary chunk to a specific peer with backpressure.
   * Waits when the DataChannel send buffer is too full to avoid silent data loss.
   */
  async sendChunkTo(peerId: string, data: any, maxBuffer = 1 * 1024 * 1024): Promise<boolean> {
    const conn = this.connections.get(peerId)
    if (!conn?.open) return false

    // PeerJS DataConnection wraps RTCDataChannel — access via _dc or dataChannel
    const dc = (conn as any)._dc || (conn as any).dataChannel
    if (dc) {
      let waits = 0
      while (dc.bufferedAmount > maxBuffer && waits < 200) {
        await new Promise((r) => setTimeout(r, 20))
        waits++
      }
    }

    try {
      conn.send(data)
      return true
    } catch (e) {
      console.error('[SongShare] sendChunkTo error:', e)
      return false
    }
  }

  sendToHost(data: any) {
    this.sendTo(`${PEER_PREFIX}${this.roomCode}`, data)
  }

  /* ── Media Calls (Voice Chat) ─────────────────── */

  /** Faz uma chamada de mídia para um peer remoto. */
  callWithStream(peerId: string, stream: MediaStream): MediaConnection | null {
    if (!this.peer || this.peer.destroyed) return null

    // Não chamar a si mesmo
    if (peerId === this.peer?.id) return null

    // If an existing call to this peer exists, close it first.
    // This handles the case where signaling dropped and we're re-calling
    // with a fresh MediaConnection after toggling mic off/on.
    const existing = this.mediaCalls.get(peerId)
    if (existing) {
      try { existing.close() } catch { /* noop */ }
      this.mediaCalls.delete(peerId)
    }

    try {
      const call = this.peer.call(peerId, stream)
      if (!call) return null

      this.mediaCalls.set(peerId, call)

      call.on('error', (err) => {
        console.error('[SongShare] Media call error:', err)
        this.mediaCalls.delete(peerId)
      })

      call.on('close', () => {
        this.mediaCalls.delete(peerId)
        this.emit('media-call-closed', { peerId })
      })

      return call
    } catch (e) {
      console.error('[SongShare] callWithStream error:', e)
      return null
    }
  }

  /** Encerra chamada de mídia com um peer específico. */
  hangupMedia(peerId: string) {
    const call = this.mediaCalls.get(peerId)
    if (call) {
      try { call.close() } catch { /* noop */ }
    }
    this.mediaCalls.delete(peerId)
  }

  /** Encerra todas as chamadas de mídia. */
  hangupAllMedia() {
    this.mediaCalls.forEach((call) => {
      try { call.close() } catch { /* noop */ }
    })
    this.mediaCalls.clear()
  }

  /**
   * Broadcast binary chunk to all connections with backpressure.
   * Waits when any DataChannel send buffer is too full.
   */
  async broadcastChunk(data: any, maxBuffer = 1 * 1024 * 1024): Promise<void> {
    const promises: Promise<void>[] = []
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        promises.push(
          (async () => {
            const dc = (conn as any)._dc || (conn as any).dataChannel
            if (dc) {
              let waits = 0
              while (dc.bufferedAmount > maxBuffer && waits < 200) {
                await new Promise((r) => setTimeout(r, 20))
                waits++
              }
            }
            try { conn.send(data) } catch (e) { console.error('[SongShare] broadcastChunk error:', e) }
          })()
        )
      }
    })
    await Promise.all(promises)
  }

  /** Retorna a lista de peer IDs conectados (data connections). */
  getConnectedPeerIds(): string[] {
    return Array.from(this.connections.keys())
  }

  /** Retorna o próprio peer ID. */
  getMyPeerId(): string {
    return this.peer?.id || ''
  }

  /* ── Cleanup ──────────────────────────────────── */

  destroy() {
    this.stopReconnectLoop()
    this._reconnectingToHost = null
    this.hangupAllMedia()
    this.connections.forEach((c) => { try { c.close() } catch { /* noop */ } })
    this.connections.clear()
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
    this.peer = null
  }

  disconnect() {
    this.destroy()
    this.roomCode = ''
    this.isHost = false
  }
}

/* Singleton */
export const peerManager = new PeerManager()
