'use client'

import { useEffect, useRef, useCallback } from 'react'
import { PeerManager, generateId } from '@/lib/peer-manager'
import { useSongShareStore } from '@/store/songshare'
import type { RoomUser, Track, ChatMessage, RoomState, VoiceStreamInfo } from '@/store/songshare'
import type { MediaConnection } from 'peerjs'

const CHUNK_SIZE = 512 * 1024 // 512 KB
const SPEAKING_THRESHOLD = 0.02

/**
 * usePeerShare — hook P2P que substitui useSongShareSocket.
 *
 * Mantém a MESMA interface pública para que page.tsx e os componentes
 * não precisem de nenhuma alteração.
 */
export function usePeerShare() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const managerRef = useRef<PeerManager | null>(null)
  const timeSyncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunksCountRef = useRef<Map<string, number>>(new Map())
  const lastTimeUpdateRef = useRef(0) // Throttle timeupdate state writes
  const speakingIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  // ── Zustand selectors ────────────────────────────
  const room = useSongShareStore((s) => s.room)
  const username = useSongShareStore((s) => s.username)
  const isConnected = useSongShareStore((s) => s.isConnected)

  const setPhase = useSongShareStore((s) => s.setPhase)
  const setRoom = useSongShareStore((s) => s.setRoom)
  const updateRoom = useSongShareStore((s) => s.updateRoom)
  const setRoomCode = useSongShareStore((s) => s.setRoomCode)
  const setIsConnected = useSongShareStore((s) => s.setIsConnected)
  const setSocket = useSongShareStore((s) => s.setSocket)
  const setAudioUrl = useSongShareStore((s) => s.setAudioUrl)
  const addChunkToStore = useSongShareStore((s) => s.addChunk)
  const getAssembledBlob = useSongShareStore((s) => s.getAssembledBlob)
  const clearPendingChunks = useSongShareStore((s) => s.clearPendingChunks)
  const reset = useSongShareStore((s) => s.reset)

  // Voice selectors
  const setMicActive = useSongShareStore((s) => s.setMicActive)
  const setMicMuted = useSongShareStore((s) => s.setMicMuted)
  const setMicStream = useSongShareStore((s) => s.setMicStream)
  const addVoiceStream = useSongShareStore((s) => s.addVoiceStream)
  const removeVoiceStream = useSongShareStore((s) => s.removeVoiceStream)
  const setVoiceStreamVolume = useSongShareStore((s) => s.setVoiceStreamVolume)
  const setVoiceStreamSpeaking = useSongShareStore((s) => s.setVoiceStreamSpeaking)
  const clearVoiceStreams = useSongShareStore((s) => s.clearVoiceStreams)
  const setAllPeerIds = useSongShareStore((s) => s.setAllPeerIds)
  const setUserMicState = useSongShareStore((s) => s.setUserMicState)
  const removeUserMicState = useSongShareStore((s) => s.removeUserMicState)

  // ── Voice helper: detect speaking via AnalyserNode ─────
  const startSpeakingDetection = useCallback((peerId: string, stream: MediaStream) => {
    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const interval = setInterval(() => {
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const average = sum / dataArray.length / 255
      const isSpeaking = average > SPEAKING_THRESHOLD
      setVoiceStreamSpeaking(peerId, isSpeaking)
    }, 150)

    speakingIntervalsRef.current.set(peerId, interval)
  }, [setVoiceStreamSpeaking])

  const stopSpeakingDetection = useCallback((peerId: string) => {
    const interval = speakingIntervalsRef.current.get(peerId)
    if (interval) {
      clearInterval(interval)
      speakingIntervalsRef.current.delete(peerId)
    }
  }, [])

  // ── Voice helper: process incoming voice stream ───────
  const processIncomingStream = useCallback((peerId: string, remoteStream: MediaStream) => {
    const store = useSongShareStore.getState()

    // Don't add if already exists
    if (store.voiceStreams.has(peerId)) return

    // Create Web Audio API chain for volume control
    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(remoteStream)
    const gainNode = audioContext.createGain()
    gainNode.gain.value = 1.0 // default volume
    source.connect(gainNode)
    gainNode.connect(audioContext.destination)

    const info: VoiceStreamInfo = {
      stream: remoteStream,
      audioContext,
      gainNode,
      volume: 1.0,
      isSpeaking: false,
    }

    store.addVoiceStream(peerId, info)
    startSpeakingDetection(peerId, remoteStream)
  }, [startSpeakingDetection])

  // ── Init PeerManager + event handlers ────────────

  useEffect(() => {
    const manager = new PeerManager()
    managerRef.current = manager

    // Conectar ao servidor de sinalização PeerJS ao montar
    manager.connect().then(() => setIsConnected(true)).catch(() => setIsConnected(false))

    /* ─── Event: incoming media call (voice) ──── */
    const unsubIncomingCall = manager.on('incoming-call', (mediaCall: MediaConnection) => {
      // Attach stream listener BEFORE answering to avoid race condition
      mediaCall.on('stream', (remoteStream) => {
        processIncomingStream(mediaCall.peer, remoteStream)
      })

      mediaCall.on('close', () => {
        removeVoiceStream(mediaCall.peer)
        stopSpeakingDetection(mediaCall.peer)
      })

      mediaCall.on('error', (err) => {
        console.error('[SongShare] Incoming call error:', err)
        removeVoiceStream(mediaCall.peer)
        stopSpeakingDetection(mediaCall.peer)
      })

      // Auto-answer all incoming voice calls
      mediaCall.answer()
    })

    /* ─── Event: media call closed ─────────────── */
    const unsubMediaCallClosed = manager.on('media-call-closed', (data: { peerId: string }) => {
      removeVoiceStream(data.peerId)
      stopSpeakingDetection(data.peerId)
    })

    /* ─── Event: join-request (host recebe) ─────── */
    const unsubJoin = manager.on('join-request', (data: { username: string; userId: string; peerId: string; reconnecting?: boolean }) => {
      const state = useSongShareStore.getState()
      if (!state.room) return

      // If reconnecting, check if user already exists in room
      const existingUser = state.room.users.find((u) => u.id === data.userId)
      if (data.reconnecting && existingUser) {
        // User is reconnecting — update peerId and send current state
        const updatedUsers = state.room.users.map((u) =>
          u.id === data.userId ? { ...u, peerId: data.peerId } : u
        )
        const updated: RoomState = { ...state.room, users: updatedUsers }
        useSongShareStore.getState().setRoom(updated)

        // Send current room state so they get back in sync
        manager.sendTo(data.peerId, { type: 'join-accepted', room: updated })

        // Re-send peer list for voice mesh
        const allPeers = [manager.getMyPeerId(), ...Array.from(manager.connections.keys())]
        manager.sendTo(data.peerId, { type: 'peer-list', peerIds: allPeers })
        setAllPeerIds(allPeers)

        // If host mic is active, call the reconnected peer
        const hostStore = useSongShareStore.getState()
        if (hostStore.isMicActive && hostStore.micStream) {
          manager.callWithStream(data.peerId, hostStore.micStream)
        }

        return
      }

      const user: RoomUser = { id: data.userId, username: data.username, isHost: false, peerId: data.peerId }
      const sysMsg: ChatMessage = {
        id: generateId(),
        username: 'Sistema',
        content: `${data.username} entrou na sala.`,
        timestamp: Date.now(),
        type: 'system',
      }

      const updated: RoomState = {
        ...state.room,
        users: [...state.room.users, user],
        chatMessages: [...state.room.chatMessages, sysMsg],
      }

      useSongShareStore.getState().setRoom(updated)

      // Enviar estado completo ao novo ouvinte
      manager.sendTo(data.peerId, { type: 'join-accepted', room: updated })

      // Send list of all peer IDs to new participant (for voice chat mesh)
      const allPeers = [manager.getMyPeerId(), ...Array.from(manager.connections.keys())]
      manager.sendTo(data.peerId, { type: 'peer-list', peerIds: allPeers })

      // Notify about new peer for voice mesh
      setAllPeerIds(allPeers)

      // If host mic is active, call the new peer directly
      const hostStore = useSongShareStore.getState()
      if (hostStore.isMicActive && hostStore.micStream) {
        manager.callWithStream(data.peerId, hostStore.micStream)
      }

      // Notify existing listeners about new peer
      manager.broadcast(
        { type: 'user-joined', user, room: { users: updated.users }, newPeerId: data.peerId },
        data.peerId,
      )
      manager.broadcast(sysMsg)
    })

    /* ─── Event: listener connection lost (host side) ── */
    const unsubListenerLost = manager.on('listener-connection-lost', (data: { peerId: string }) => {
      const state = useSongShareStore.getState()
      if (!state.room || !manager.isHost) return

      // Find user by peerId and notify others
      const user = state.room.users.find((u) => u.peerId === data.peerId)
      if (user) {
        const updated: RoomState = {
          ...state.room,
          users: state.room.users.filter((u) => u.peerId !== data.peerId),
          chatMessages: [
            ...state.room.chatMessages,
            {
              id: generateId(),
              username: 'Sistema',
              content: `${user.username} perdeu a conexao.`,
              timestamp: Date.now(),
              type: 'system' as const,
            },
          ],
        }
        useSongShareStore.getState().setRoom(updated)
        manager.broadcast({ type: 'user-left', room: { users: updated.users } })

        // Clean up voice
        removeVoiceStream(data.peerId)
        stopSpeakingDetection(data.peerId)
        manager.hangupMedia(data.peerId)
        setAllPeerIds(state.allPeerIds.filter((pid) => pid !== data.peerId))
        removeUserMicState(user.id)
      }
    })

    /* ─── Event: join-accepted (ouvinte recebe) ── */
    const unsubAccepted = manager.on('join-accepted', (data: { room: RoomState }) => {
      const store = useSongShareStore.getState()
      store.setRoom(data.room)
      store.setRoomCode(data.room.code)
      store.setSocket({ id: manager.userId })
      store.setPhase('room')

      // Pedir dados de áudio das faixas que faltam
      data.room.playlist.forEach((track) => {
        if (!store.audioCache.has(track.id)) {
          manager.sendToHost({ type: 'request-track-data', trackId: track.id })
        }
      })
    })

    /* ─── Event: peer-list (receive all peer IDs for voice mesh) ── */
    const unsubPeerList = manager.on('peer-list', (data: { peerIds: string[] }) => {
      setAllPeerIds(data.peerIds)

      // If mic is active, call all peers now
      const store = useSongShareStore.getState()
      if (store.isMicActive && store.micStream) {
        data.peerIds.forEach((peerId) => {
          if (peerId !== manager.getMyPeerId()) {
            manager.callWithStream(peerId, store.micStream!)
          }
        })
      }
    })

    /* ─── Event: new-peer-available (host tells about new peer) ── */
    const unsubNewPeer = manager.on('new-peer-available', (data: { peerId: string }) => {
      const store = useSongShareStore.getState()
      const current = store.allPeerIds
      if (!current.includes(data.peerId)) {
        setAllPeerIds([...current, data.peerId])
      }

      // If mic is active, call the new peer
      if (store.isMicActive && store.micStream) {
        manager.callWithStream(data.peerId, store.micStream)
      }
    })

    /* ─── Event: voice-state-update (someone toggled mic) ── */
    const unsubVoiceState = manager.on('voice-state-update', (data: { userId: string; isMicActive: boolean; isMicMuted: boolean }) => {
      // Update local mic state tracking for this user
      setUserMicState(data.userId, { isMicActive: data.isMicActive, isMicMuted: data.isMicMuted })

      // If host, relay to all other listeners so everyone knows
      if (manager.isHost) {
        manager.broadcast({ type: 'voice-state-update', ...data })
      }
    })

    /* ─── Event: host-disconnected ──────────────── */
    const unsubHostOff = manager.on('host-disconnected', () => {
      const state = useSongShareStore.getState()
      if (!state.room) return
      const sysMsg: ChatMessage = {
        id: generateId(),
        username: 'Sistema',
        content: 'O host desconectou. A sala foi encerrada.',
        timestamp: Date.now(),
        type: 'system',
      }
      updateRoom({ chatMessages: [...state.room.chatMessages, sysMsg] })

      // Clean up voice streams
      clearVoiceStreams()
      speakingIntervalsRef.current.forEach((interval) => clearInterval(interval))
      speakingIntervalsRef.current.clear()
    })

    /* ─── Event: user-joined / user-left ────────── */
    const unsubUserJoined = manager.on('user-joined', (data: { user: RoomUser; room: Partial<RoomState>; newPeerId?: string }) => {
      updateRoom(data.room)

      // Update peer list
      if (data.newPeerId) {
        const store = useSongShareStore.getState()
        const current = store.allPeerIds
        if (!current.includes(data.newPeerId)) {
          setAllPeerIds([...current, data.newPeerId])
        }

        // If mic is active, call the new peer
        if (store.isMicActive && store.micStream) {
          manager.callWithStream(data.newPeerId, store.micStream)
        }
      }
    })

    const unsubUserLeft = manager.on('user-left', (data: { room: Partial<RoomState> }) => {
      updateRoom(data.room)
    })

    /* ─── Event: user-left-request (host recebe) ── */
    const unsubLeftReq = manager.on('user-left-request', (data: { userId: string; peerId: string }) => {
      const state = useSongShareStore.getState()
      if (!state.room) return

      const updated: RoomState = { ...state.room }
      updated.users = updated.users.filter((u) => u.id !== data.userId)
      const sysMsg: ChatMessage = {
        id: generateId(),
        username: 'Sistema',
        content: 'Um ouvinte saiu da sala.',
        timestamp: Date.now(),
        type: 'system',
      }
      updated.chatMessages = [...updated.chatMessages, sysMsg]

      useSongShareStore.getState().setRoom(updated)

      // Update peer IDs
      const currentPeerIds = state.allPeerIds.filter((pid) => pid !== data.peerId)
      setAllPeerIds(currentPeerIds)

      // Clean up mic state for this user
      removeUserMicState(data.userId)

      manager.broadcast({ type: 'user-left', room: { users: updated.users } })
      manager.broadcast(sysMsg)

      // Clean up voice for this peer
      removeVoiceStream(data.peerId)
      stopSpeakingDetection(data.peerId)
      manager.hangupMedia(data.peerId)

      // Encerrar conexão com esse peer
      const conn = manager.connections.get(data.peerId)
      if (conn) conn.close()
      manager.connections.delete(data.peerId)
    })

    /* ─── Eventos de reprodução (ouvintes recebem) ─ */

    const unsubPlay = manager.on('play', (data: { currentTime: number }) => {
      updateRoom({ isPlaying: true, currentTime: data.currentTime })
      const audio = audioRef.current
      if (audio) {
        if (Math.abs(audio.currentTime - data.currentTime) > 1.5) audio.currentTime = data.currentTime
        audio.play().catch(() => {})
      }
    })

    const unsubPause = manager.on('pause', (data: { currentTime: number }) => {
      updateRoom({ isPlaying: false, currentTime: data.currentTime })
      audioRef.current?.pause()
    })

    const unsubSeek = manager.on('seek', (data: { time: number }) => {
      updateRoom({ currentTime: data.time })
      if (audioRef.current) audioRef.current.currentTime = data.time
    })

    const unsubSync = manager.on('time-sync', (data: { currentTime: number }) => {
      updateRoom({ currentTime: data.currentTime })
      const audio = audioRef.current
      if (audio && !audio.paused && Math.abs(audio.currentTime - data.currentTime) > 2) {
        audio.currentTime = data.currentTime
      }
    })

    const unsubTrackChanged = manager.on('track-changed', (data: { currentTrackIndex: number; currentTime: number; playlist: Track[] }) => {
      updateRoom({
        currentTrackIndex: data.currentTrackIndex,
        currentTime: data.currentTime,
        playlist: data.playlist,
      })
      const audio = audioRef.current
      if (!audio) return
      audio.pause()
      audio.currentTime = 0
      const track = data.playlist[data.currentTrackIndex]
      if (track) {
        const url = useSongShareStore.getState().audioCache.get(track.id)
        if (url) {
          audio.src = url
          audio.currentTime = data.currentTime
        }
      }
    })

    const unsubEnded = manager.on('playlist-ended', () => {
      updateRoom({ isPlaying: false, currentTime: 0 })
      const audio = audioRef.current
      if (audio) { audio.pause(); audio.currentTime = 0 }
    })

    const unsubPlaylist = manager.on('playlist-updated', (data: Partial<RoomState>) => {
      updateRoom(data)

      // Request audio data for any tracks we don't have yet (new tracks added after join)
      if (data.playlist && !manager.isHost) {
        const store = useSongShareStore.getState()
        data.playlist.forEach((track) => {
          if (!store.audioCache.has(track.id) && !store.pendingChunks.has(track.id)) {
            manager.sendToHost({ type: 'request-track-data', trackId: track.id })
          }
        })
      }
    })

    /* ─── Letras de música ───────────────────────── */

    const unsubLyrics = manager.on('track-lyrics-updated', (data: { trackId: string; lyrics: string }) => {
      const state = useSongShareStore.getState()
      if (!state.room) return

      const updatedPlaylist = state.room.playlist.map((track) =>
        track.id === data.trackId ? { ...track, lyrics: data.lyrics } : track
      )

      updateRoom({ playlist: updatedPlaylist })
    })

    /* ─── Transferência de áudio ────────────────── */

    const unsubChunk = manager.on('track-data-chunk', (data: { trackId: string; chunkIndex: number; totalChunks: number; data: ArrayBuffer | Uint8Array }) => {
      const buf = data.data instanceof ArrayBuffer ? data.data : new Uint8Array(data.data).buffer

      addChunkToStore(data.trackId, data.chunkIndex, data.totalChunks, buf)

      const counts = chunksCountRef.current
      counts.set(data.trackId, (counts.get(data.trackId) || 0) + 1)

      if (counts.get(data.trackId)! >= data.totalChunks) {
        const assembled = getAssembledBlob(data.trackId)
        if (assembled) {
          const url = URL.createObjectURL(new Blob([assembled], { type: 'audio/mpeg' }))
          useSongShareStore.getState().setAudioUrl(data.trackId, url)

          const st = useSongShareStore.getState()
          if (st.room) {
            const ct = st.room.playlist[st.room.currentTrackIndex]
            if (ct && ct.id === data.trackId && audioRef.current) {
              audioRef.current.src = url
              if (st.room.isPlaying) {
                audioRef.current.currentTime = st.room.currentTime
                audioRef.current.play().catch(() => {})
              }
            }
          }
        }
        clearPendingChunks(data.trackId)
        counts.delete(data.trackId)
      }
    })

    /* ─── Reenvio de faixa (host recebe pedido) ─── */

    const unsubReqData = manager.on('request-track-data', (data: { trackId: string; senderPeerId: string }) => {
      const state = useSongShareStore.getState()
      if (!manager.isHost) return

      const url = state.audioCache.get(data.trackId)
      if (!url) return

      fetch(url)
        .then((r) => r.arrayBuffer())
        .then(async (buffer) => {
          const uint8 = new Uint8Array(buffer)
          const total = Math.ceil(uint8.byteLength / CHUNK_SIZE)
          for (let i = 0; i < total; i++) {
            const start = i * CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, uint8.byteLength)
            await manager.sendChunkTo(data.senderPeerId, {
              type: 'track-data-chunk',
              trackId: data.trackId,
              chunkIndex: i,
              totalChunks: total,
              data: uint8.slice(start, end),
            })
            // Small pause every 5 chunks to avoid buffer overflow
            if (i % 5 === 0) await new Promise((r) => setTimeout(r, 5))
          }
        })
        .catch(console.error)
    })

    /* ─── Chat ──────────────────────────────────── */

    const unsubChat = manager.on('chat-message', (data: { message: ChatMessage } | ChatMessage) => {
      const msg: ChatMessage = 'message' in data ? data.message : data
      const state = useSongShareStore.getState()
      updateRoom({ chatMessages: [...(state.room?.chatMessages || []), msg] })
    })

    /* ─── Conexão / desconexão do signaling ─────── */

    const unsubConnected = manager.on('connected', () => setIsConnected(true))
    const unsubDisconnected = manager.on('disconnected', () => setIsConnected(false))

    /* ─── Cleanup ───────────────────────────────── */

    return () => {
      ;[
        unsubIncomingCall, unsubMediaCallClosed,
        unsubJoin, unsubAccepted, unsubPeerList, unsubNewPeer, unsubVoiceState,
        unsubHostOff,
        unsubUserJoined, unsubUserLeft, unsubLeftReq, unsubListenerLost,
        unsubPlay, unsubPause, unsubSeek, unsubSync,
        unsubTrackChanged, unsubEnded, unsubPlaylist,
        unsubLyrics,
        unsubChunk, unsubReqData, unsubChat,
        unsubConnected, unsubDisconnected,
      ].forEach((fn) => fn?.())

      // Clean up speaking detection
      speakingIntervalsRef.current.forEach((interval) => clearInterval(interval))
      speakingIntervalsRef.current.clear()

      manager.disconnect()
      if (timeSyncRef.current) clearInterval(timeSyncRef.current)
    }
  }, [])

  /* ── Host time-sync ──────────────────────────── */

  useEffect(() => {
    const manager = managerRef.current
    if (!manager || !room || !manager.isHost || !room.isPlaying) {
      if (timeSyncRef.current) { clearInterval(timeSyncRef.current); timeSyncRef.current = null }
      return
    }

    timeSyncRef.current = setInterval(() => {
      const audio = audioRef.current
      if (audio && !audio.paused) {
        manager.broadcast({ type: 'time-sync', currentTime: audio.currentTime })
      }
    }, 3000)

    return () => {
      if (timeSyncRef.current) { clearInterval(timeSyncRef.current); timeSyncRef.current = null }
    }
  }, [room?.isPlaying, room?.hostId])

  /* ── Audio element events ──────────────────────── */

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      // Throttle: only update Zustand store ~2x/sec to avoid excessive re-renders
      const now = performance.now()
      if (now - lastTimeUpdateRef.current < 500) return
      lastTimeUpdateRef.current = now
      useSongShareStore.getState().updateRoom({ currentTime: audio.currentTime })
    }

    const onEnded = () => {
      const mgr = managerRef.current
      if (mgr && mgr.isHost) {
        const st = useSongShareStore.getState()
        if (!st.room) return
        if (st.room.currentTrackIndex < st.room.playlist.length - 1) {
          const updated = { ...st.room, currentTrackIndex: st.room.currentTrackIndex + 1, currentTime: 0 }
          useSongShareStore.getState().setRoom(updated)
          mgr.broadcast({
            type: 'track-changed',
            currentTrackIndex: updated.currentTrackIndex,
            currentTime: 0,
            playlist: updated.playlist,
          })
        } else {
          const updated = { ...st.room, isPlaying: false, currentTime: 0 }
          useSongShareStore.getState().setRoom(updated)
          mgr.broadcast({ type: 'playlist-ended' })
        }
      }
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
    }
  }, [room?.hostId])

  /* ── Sync da faixa atual quando muda ───────────── */

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !room || room.currentTrackIndex < 0) return

    const track = room.playlist[room.currentTrackIndex]
    if (!track) return

    const url = useSongShareStore.getState().audioCache.get(track.id)
    if (url && audio.src !== url) {
      audio.src = url
      if (room.isPlaying) {
        audio.currentTime = room.currentTime || 0
        audio.play().catch(() => {})
      }
    }
  }, [room?.currentTrackIndex, room?.isPlaying])

  /* ── Ações públicas ───────────────────────────── */

  const createRoom = useCallback(async () => {
    const manager = managerRef.current!
    const name = username.trim()
    if (!name) return

    manager.disconnect()
    setIsConnected(false)

    try {
      const code = await manager.createRoom(name)
      setRoomCode(code)
      setSocket({ id: manager.userId })
      setIsConnected(true)

      // Set own peer ID in the peer list
      setAllPeerIds([manager.getMyPeerId()])

      const roomState: RoomState = {
        code,
        hostId: manager.userId,
        users: [{ id: manager.userId, username: name, isHost: true, peerId: manager.getMyPeerId() }],
        playlist: [],
        currentTrackIndex: -1,
        isPlaying: false,
        currentTime: 0,
        chatMessages: [{
          id: generateId(),
          username: 'Sistema',
          content: `${name} criou a sala. Compartilhe o código: ${code}`,
          timestamp: Date.now(),
          type: 'system',
        }],
      }

      setRoom(roomState)
      setPhase('room')
    } catch (err: any) {
      // Reconectar para próxima tentativa
      manager.connect().then(() => setIsConnected(true)).catch(() => {})
      alert(err.message || 'Erro ao criar sala')
    }
  }, [username, setRoom, setRoomCode, setPhase, setIsConnected, setSocket, setAllPeerIds])

  const joinRoom = useCallback(async (code: string) => {
    const manager = managerRef.current!
    const name = username.trim()
    if (!name) return

    manager.disconnect()
    setIsConnected(false)

    try {
      await manager.joinRoom(code.toUpperCase(), name)
      setSocket({ id: manager.userId })
      setIsConnected(true)
    } catch (err: any) {
      manager.connect().then(() => setIsConnected(true)).catch(() => {})
      alert(err.message || 'Sala não encontrada')
    }
  }, [username, setIsConnected, setSocket])

  const addTrack = useCallback(async (file: File, lyrics?: string) => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!state.room || !manager.isHost) return

    const trackId = generateId()

    // Ler metadados
    const trackName = file.name.replace(/\.[^.]+$/, '')
    const duration = await new Promise<number>((resolve) => {
      const tmp = new Audio()
      tmp.src = URL.createObjectURL(file)
      tmp.addEventListener('loadedmetadata', () => { resolve(tmp.duration); URL.revokeObjectURL(tmp.src) })
      tmp.addEventListener('error', () => resolve(0))
    })

    const track: Track = {
      id: trackId,
      name: trackName,
      artist: username.trim(),
      duration,
      addedBy: username.trim(),
      addedAt: Date.now(),
      lyrics: lyrics || '',
    }

    // Atualizar estado local
    const updated: RoomState = { ...state.room! }
    updated.playlist = [...updated.playlist, track]
    if (updated.playlist.length === 1) updated.currentTrackIndex = 0
    setRoom(updated)

    // Broadcasting
    manager.broadcast({
      type: 'playlist-updated',
      playlist: updated.playlist,
      currentTrackIndex: updated.currentTrackIndex,
    })

    // Cache local
    const blobUrl = URL.createObjectURL(file)
    setAudioUrl(trackId, blobUrl)
    if (updated.playlist.length === 1 && audioRef.current) {
      audioRef.current.src = blobUrl
    }

    // Enviar arquivo em chunks para todos os ouvintes (with backpressure)
    const buffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(buffer)
    const totalChunks = Math.ceil(uint8.byteLength / CHUNK_SIZE)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, uint8.byteLength)

      await manager.broadcastChunk({
        type: 'track-data-chunk',
        trackId,
        chunkIndex: i,
        totalChunks,
        data: uint8.slice(start, end),
      })

      // Small pause every 5 chunks to avoid overwhelming the DataChannel
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 5))
    }
  }, [username, setRoom, setAudioUrl])

  const removeTrack = useCallback((trackId: string) => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!state.room || !manager.isHost) return

    const updated: RoomState = { ...state.room! }
    const idx = updated.playlist.findIndex((t) => t.id === trackId)
    if (idx === -1) return

    updated.playlist.splice(idx, 1)
    if (updated.currentTrackIndex >= updated.playlist.length) {
      updated.currentTrackIndex = updated.playlist.length - 1
    }
    if (updated.playlist.length === 0) {
      updated.currentTrackIndex = -1
      updated.isPlaying = false
      updated.currentTime = 0
    }

    setRoom(updated)
    manager.broadcast({
      type: 'playlist-updated',
      playlist: updated.playlist,
      currentTrackIndex: updated.currentTrackIndex,
      isPlaying: updated.isPlaying,
      currentTime: updated.currentTime,
    })
  }, [setRoom])

  const play = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return
    const audio = audioRef.current
    const currentTime = audio?.currentTime || 0

    audio?.play().catch(() => {})
    updateRoom({ isPlaying: true })
    manager.broadcast({ type: 'play', currentTime })
  }, [updateRoom])

  const pause = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return
    const audio = audioRef.current
    const currentTime = audio?.currentTime || 0

    audio?.pause()
    updateRoom({ isPlaying: false })
    manager.broadcast({ type: 'pause', currentTime })
  }, [updateRoom])

  const seek = useCallback((time: number) => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return

    if (audioRef.current) audioRef.current.currentTime = time
    manager.broadcast({ type: 'seek', time })
  }, [])

  const nextTrack = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return

    if (state.room.currentTrackIndex < state.room.playlist.length - 1) {
      const updated: RoomState = { ...state.room, currentTrackIndex: state.room.currentTrackIndex + 1, currentTime: 0 }
      setRoom(updated)
      manager.broadcast({
        type: 'track-changed',
        currentTrackIndex: updated.currentTrackIndex,
        currentTime: 0,
        playlist: updated.playlist,
      })
    } else {
      const updated: RoomState = { ...state.room, isPlaying: false, currentTime: 0 }
      setRoom(updated)
      manager.broadcast({ type: 'playlist-ended' })
    }
  }, [setRoom])

  const previousTrack = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return

    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      manager.broadcast({ type: 'seek', time: 0 })
    } else if (state.room.currentTrackIndex > 0) {
      const updated: RoomState = { ...state.room, currentTrackIndex: state.room.currentTrackIndex - 1, currentTime: 0 }
      setRoom(updated)
      manager.broadcast({
        type: 'track-changed',
        currentTrackIndex: updated.currentTrackIndex,
        currentTime: 0,
        playlist: updated.playlist,
      })
    }
  }, [setRoom])

  const sendChatMessage = useCallback((content: string) => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!content.trim() || !state.room) return

    const msg: ChatMessage = {
      id: generateId(),
      username: username.trim(),
      content: content.trim().substring(0, 500),
      timestamp: Date.now(),
      type: 'user',
    }

    // Adicionar localmente
    updateRoom({ chatMessages: [...state.room.chatMessages, msg] })

    // Enviar para os outros
    if (manager.isHost) {
      manager.broadcast({ type: 'chat-message', message: msg })
    } else {
      manager.sendToHost({ type: 'chat-message', message: msg })
    }
  }, [username, updateRoom])

  const updateTrackLyrics = useCallback((trackId: string, lyrics: string) => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!state.room || !manager.isHost) return

    // Atualizar localmente
    const updatedPlaylist = state.room.playlist.map((track) =>
      track.id === trackId ? { ...track, lyrics } : track
    )
    updateRoom({ playlist: updatedPlaylist })

    // Broadcasting para todos os ouvintes
    manager.broadcast({ type: 'track-lyrics-updated', trackId, lyrics })
  }, [updateRoom])

  /* ── Voice Chat Actions ──────────────────────── */

  const toggleMic = useCallback(async () => {
    const manager = managerRef.current!
    const store = useSongShareStore.getState()

    if (store.isMicActive) {
      // Deactivate mic
      if (store.micStream) {
        store.micStream.getTracks().forEach((t) => t.stop())
      }
      setMicStream(null)
      setMicActive(false)
      setMicMuted(false)
      manager.hangupAllMedia()

      // Notify others
      if (manager.isHost) {
        manager.broadcast({
          type: 'voice-state-update',
          userId: manager.userId,
          isMicActive: false,
          isMicMuted: false,
        })
      } else {
        manager.sendToHost({
          type: 'voice-state-update',
          userId: manager.userId,
          isMicActive: false,
          isMicMuted: false,
        })
      }
    } else {
      // Activate mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })

        setMicStream(stream)
        setMicActive(true)
        setMicMuted(false)

        // Call all known peers with this stream
        const peerIds = store.allPeerIds
        peerIds.forEach((peerId) => {
          if (peerId !== manager.getMyPeerId()) {
            manager.callWithStream(peerId, stream)
          }
        })

        // Notify others
        if (manager.isHost) {
          manager.broadcast({
            type: 'voice-state-update',
            userId: manager.userId,
            isMicActive: true,
            isMicMuted: false,
          })
        } else {
          manager.sendToHost({
            type: 'voice-state-update',
            userId: manager.userId,
            isMicActive: true,
            isMicMuted: false,
          })
        }
      } catch (err: any) {
        console.error('[SongShare] Mic access error:', err)
        alert('Não foi possível acessar o microfone. Verifique as permissões.')
      }
    }
  }, [setMicStream, setMicActive, setMicMuted, setUserMicState])

  const toggleMute = useCallback(() => {
    const store = useSongShareStore.getState()
    if (!store.isMicActive || !store.micStream) return

    const newMuted = !store.isMicMuted
    setMicMuted(newMuted)

    store.micStream.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted
    })

    // Notify others
    const manager = managerRef.current!
    if (manager.isHost) {
      manager.broadcast({
        type: 'voice-state-update',
        userId: manager.userId,
        isMicActive: true,
        isMicMuted: newMuted,
      })
    } else {
      manager.sendToHost({
        type: 'voice-state-update',
        userId: manager.userId,
        isMicActive: true,
        isMicMuted: newMuted,
      })
    }
  }, [setMicMuted])

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    setVoiceStreamVolume(peerId, volume)
  }, [setVoiceStreamVolume])

  /** Re-sync isConnected with the actual PeerJS peer state (e.g. after reset). */
  const resyncIsConnected = useCallback(() => {
    const manager = managerRef.current
    if (manager?.peer && !manager.peer.destroyed && !manager.peer.disconnected) {
      setIsConnected(true)
    } else {
      setIsConnected(false)
    }
  }, [setIsConnected])

  return {
    audioRef,
    createRoom,
    joinRoom,
    addTrack,
    removeTrack,
    play,
    pause,
    seek,
    nextTrack,
    previousTrack,
    sendChatMessage,
    updateTrackLyrics,
    // Voice chat
    toggleMic,
    toggleMute,
    setPeerVolume,
    resyncIsConnected,
  }
}
