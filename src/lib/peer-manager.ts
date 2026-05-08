import Peer, { DataConnection, MediaConnection } from 'peerjs'

export const PEER_PREFIX = 'songshare-'

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

  /** Cria peer com ID aleatório (usado ao montar o app). */
  async connect(): Promise<void> {
    this.destroy()
    await this._createPeer()
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
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) this.peer.reconnect()
        }, 2000)
      })
    })
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

    // Garantir que o peer local existe
    if (!this.peer || this.peer.destroyed) {
      await this._createPeer()
    }

    const hostPeerId = `${PEER_PREFIX}${this.roomCode}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Sala não encontrada ou host offline. Verifique o código.'))
      }, 10000)

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
      this.connections.delete(conn.peer)
      if (!this.isHost) {
        this.emit('host-disconnected', {})
      }
    })

    conn.on('error', (err) => {
      console.error('[SongShare] Conn error:', err)
    })
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
      default:
        // Encaminhar todos os outros tipos para o hook
        this.emit(data.type, data)
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

  sendToHost(data: any) {
    this.sendTo(`${PEER_PREFIX}${this.roomCode}`, data)
  }

  /* ── Media Calls (Voice Chat) ─────────────────── */

  /** Faz uma chamada de mídia para um peer remoto. */
  callWithStream(peerId: string, stream: MediaStream): MediaConnection | null {
    if (!this.peer || this.peer.destroyed) return null

    // Não chamar a si mesmo
    if (peerId === this.peer?.id) return null

    // Não duplicar chamada existente
    const existing = this.mediaCalls.get(peerId)
    if (existing && this.mediaCalls.has(peerId)) return existing

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
