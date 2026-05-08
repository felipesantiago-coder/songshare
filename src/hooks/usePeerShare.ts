'use client'

import { useEffect, useRef, useCallback } from 'react'
import { PeerManager, generateId } from '@/lib/peer-manager'
import { useSongShareStore } from '@/store/songshare'
import type { RoomUser, Track, ChatMessage, RoomState, VoiceStreamInfo } from '@/store/songshare'
import type { MediaConnection } from 'peerjs'

const CHUNK_SIZE = 512 * 1024 // 512 KB
const SPEAKING_THRESHOLD = 0.02
const PING_INTERVAL = 5000 // ms between RTT pings
const SYNC_INTERVAL = 1500 // ms between time-syncs (reduced from 3000)
const DRIFT_THRESHOLD_SOFT = 0.3 // seconds — start smooth rate correction
const DRIFT_THRESHOLD_HARD = 1.5 // seconds — hard seek (reduced from 2.0)
const MAX_CORRECTION_RATE = 0.05 // max playbackRate deviation for drift correction

// ── Noise reduction settings ──
const HIGH_PASS_FREQ = 80 // Hz — removes AC hum, wind, low rumble
const NOISE_GATE_OPEN_THRESHOLD = 0.018 // volume level to open the gate
const NOISE_GATE_CLOSE_THRESHOLD = 0.012 // volume level to close the gate (hysteresis)
const NOISE_GATE_ATTACK_MS = 10 // ms to fully open gate (fast — no word clipping)
const NOISE_GATE_RELEASE_MS = 150 // ms to fully close gate (smooth — no click artifacts)
const NOISE_GATE_HOLD_MS = 200 // ms to hold open after speech stops (avoids cutting word endings)

/**
 * Compute latency-compensated host time.
 * Uses sentAt for per-message transit time accuracy when available;
 * falls back to the pre-computed RTT/2 estimate from ping/pong.
 */
function compensateTime(hostTime: number, sentAt?: number, latencyMs?: number): number {
  if (sentAt) {
    // Actual one-way transit time for THIS specific message (host→listener)
    return hostTime + (Date.now() - sentAt) / 1000
  }
  // Fallback: use pre-computed latency estimate
  return hostTime + (latencyMs ?? 0) / 1000
}

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
  const latencyRef = useRef<number>(0) // estimated one-way latency in ms (median filter)
  const latencyHistoryRef = useRef<number[]>([]) // last 10 RTT/2 samples
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const localMicAnalysisRef = useRef<{ audioContext: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null)
  const noiseProcessorRef = useRef<{
    audioContext: AudioContext
    source: MediaStreamAudioSourceNode
    highPass: BiquadFilterNode
    noiseGate: GainNode
    destination: MediaStreamAudioDestinationNode
    processedStream: MediaStream
    cleanupInterval: ReturnType<typeof setInterval>
  } | null>(null)
  // Silent stream for answering calls — ensures SDP answer includes m=audio
  // so we can receive the remote peer's audio even when our mic is off
  const silentAnswerStreamRef = useRef<MediaStream | null>(null)
  const silentAnswerCtxRef = useRef<AudioContext | null>(null)
  // Stores cleanup functions for per-peer user-interaction listeners (AudioContext resume)
  const peerAudioCleanupRef = useRef<Map<string, () => void>>(new Map())
  // Pending play tracking — when a 'play' event arrives but audio data isn't available yet,
  // store the host's time and receipt timestamp so the track-data-chunk completion handler
  // can calculate the correct start position when data finally arrives.
  const pendingPlayRef = useRef<{ hostTime: number; receivedAt: number } | null>(null)

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
  const revokeAudioUrl = useSongShareStore((s) => s.revokeAudioUrl)
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
  const setLocalSpeaking = useSongShareStore((s) => s.setLocalSpeaking)

  // ── Voice helper: stop speaking detection interval ────
  const stopSpeakingDetection = useCallback((peerId: string) => {
    const interval = speakingIntervalsRef.current.get(peerId)
    if (interval) {
      clearInterval(interval)
      speakingIntervalsRef.current.delete(peerId)
    }
    // Also clean up per-peer AudioContext resume interaction listeners
    const cleanup = peerAudioCleanupRef.current.get(peerId)
    if (cleanup) {
      cleanup()
      peerAudioCleanupRef.current.delete(peerId)
    }
  }, [])

  // ── Voice helper: process incoming voice stream ───────
  // Creates a SINGLE AudioContext per remote peer for both audio output AND
  // speaking detection — avoids the browser limit of ~6 concurrent AudioContexts.
  const processIncomingStream = useCallback((peerId: string, remoteStream: MediaStream) => {
    const store = useSongShareStore.getState()

    // Don't add if already exists
    if (store.voiceStreams.has(peerId)) return

    try {
      // Validate: stream must have at least one audio track
      const audioTracks = remoteStream.getAudioTracks()
      if (audioTracks.length === 0) {
        console.warn('[SongShare] processIncomingStream: no audio tracks in stream from', peerId)
        return
      }

      // Single shared AudioContext for this peer
      const audioContext = new AudioContext()

      // ROBUST RESUME STRATEGY — AudioContext created outside user gesture
      // starts 'suspended' in Chrome 71+/Safari/iOS. Three-pronged approach:
      // 1. Immediate resume attempt
      // 2. Periodic retry every 500ms for 5 seconds
      // 3. User-interaction listener as last resort
      const tryResume = () => {
        if (audioContext.state === 'running') return
        audioContext.resume().catch(() => {})
      }
      tryResume()
      const resumeInterval = setInterval(() => {
        if (audioContext.state === 'running') clearInterval(resumeInterval)
        else tryResume()
      }, 500)
      setTimeout(() => clearInterval(resumeInterval), 5000)

      // Register user-interaction listeners that retry resume on any click/touch/keypress.
      // Stored in peerAudioCleanupRef so stopSpeakingDetection can remove them.
      const resumeOnInteraction = () => tryResume()
      document.addEventListener('click', resumeOnInteraction, { passive: true })
      document.addEventListener('touchstart', resumeOnInteraction, { passive: true })
      document.addEventListener('keydown', resumeOnInteraction, { passive: true })
      peerAudioCleanupRef.current.set(peerId, () => {
        clearInterval(resumeInterval)
        document.removeEventListener('click', resumeOnInteraction)
        document.removeEventListener('touchstart', resumeOnInteraction)
        document.removeEventListener('keydown', resumeOnInteraction)
      })

      const source = audioContext.createMediaStreamSource(remoteStream)

      // Output chain: source → gainNode → speakers
      const gainNode = audioContext.createGain()
      gainNode.gain.value = 1.0 // default volume
      source.connect(gainNode)
      gainNode.connect(audioContext.destination)

      // Analysis chain: source → analyser (NOT connected to output — just reads data)
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
        setVoiceStreamSpeaking(peerId, average > SPEAKING_THRESHOLD)
      }, 150)

      speakingIntervalsRef.current.set(peerId, interval)

      const info: VoiceStreamInfo = {
        stream: remoteStream,
        audioContext,
        gainNode,
        volume: 1.0,
        isSpeaking: false,
      }

      store.addVoiceStream(peerId, info)
    } catch (err) {
      console.error('[SongShare] processIncomingStream error for', peerId, ':', err)
    }
  }, [setVoiceStreamSpeaking])

  // ── Init PeerManager + event handlers ────────────

  useEffect(() => {
    const manager = new PeerManager()
    managerRef.current = manager

    // Conectar ao servidor de sinalização PeerJS ao montar
    manager.connect().then(() => setIsConnected(true)).catch(() => setIsConnected(false))

    /* ─── Event: incoming media call (voice) ──── */
    const unsubIncomingCall = manager.on('incoming-call', (mediaCall: MediaConnection) => {
      let streamProcessed = false

      const handleRemoteStream = (remoteStream: MediaStream) => {
        if (streamProcessed) return
        // Defensive: PeerJS may emit 'stream' with undefined if evt.streams[0] is empty
        if (!remoteStream || !(remoteStream instanceof MediaStream)) {
          console.warn('[SongShare] incoming-call: received invalid stream, ignoring')
          return
        }
        streamProcessed = true
        processIncomingStream(mediaCall.peer, remoteStream)
      }

      // Method 1: Standard PeerJS 'stream' event (fires from PeerJS internal ontrack handler)
      mediaCall.on('stream', handleRemoteStream)

      // Method 2: FALLBACK — listen for 'track' event on the underlying RTCPeerConnection.
      // CRITICAL FIX: In PeerJS v1.5.5, `connection.peerConnection` is NULL at the time
      // the 'call' event fires. The RTCPeerConnection is only created INSIDE `answer()`
      // → `startConnection()` → `_startPeerConnection()` (lines 733-753 of bundler.mjs).
      // So checking `pc` BEFORE answer() returns undefined, and the track listener is
      // never registered. The fix: add the track listener AFTER calling answer(), when
      // peerConnection is guaranteed to exist.
      //
      // Additionally, PeerJS's internal ontrack handler uses `evt.streams[0]` which can
      // be undefined in some WebRTC implementations. When that happens, PeerJS emits
      // 'stream' with undefined. Our track listener handles this by wrapping the bare
      // track in a new MediaStream.
      let trackHandler: ((ev: Event) => void) | null = null

      // Create silent answer stream (reused across all incoming calls)
      if (!silentAnswerStreamRef.current) {
        const ctx = new AudioContext()
        ctx.resume().catch(() => {})
        silentAnswerStreamRef.current = ctx.createMediaStreamDestination().stream
        silentAnswerCtxRef.current = ctx
      }

      // Answer the call — this creates the RTCPeerConnection internally
      mediaCall.answer(silentAnswerStreamRef.current)

      // NOW peerConnection is available — register our track fallback listener
      // Using setTimeout(0) to ensure answer()'s synchronous code has completed
      // and the peerConnection is fully set up
      setTimeout(() => {
        const pc = (mediaCall as any).peerConnection as RTCPeerConnection | undefined
        if (pc) {
          trackHandler = (ev: Event) => {
            if (streamProcessed) return
            const trackEvent = ev as RTCTrackEvent
            if (trackEvent.streams && trackEvent.streams.length > 0) {
              handleRemoteStream(trackEvent.streams[0])
            } else if (trackEvent.track && trackEvent.track.kind === 'audio') {
              // Track arrived without a stream association — wrap in new MediaStream
              handleRemoteStream(new MediaStream([trackEvent.track]))
            }
          }
          pc.addEventListener('track', trackHandler)

          // Also monitor ICE connection state for debugging
          pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState
            if (state === 'failed' || state === 'disconnected') {
              console.warn('[SongShare] ICE', state, 'for voice call from', mediaCall.peer)
            }
          }
        } else {
          console.warn('[SongShare] peerConnection still undefined after answer() for', mediaCall.peer)
        }
      }, 0)

      const cleanupTrackHandler = () => {
        if (trackHandler) {
          const pc = (mediaCall as any).peerConnection as RTCPeerConnection | undefined
          if (pc) pc.removeEventListener('track', trackHandler)
          trackHandler = null
        }
      }

      mediaCall.on('close', () => {
        cleanupTrackHandler()
        removeVoiceStream(mediaCall.peer)
        stopSpeakingDetection(mediaCall.peer)
      })

      mediaCall.on('error', (err) => {
        console.error('[SongShare] Incoming call error:', err)
        cleanupTrackHandler()
        removeVoiceStream(mediaCall.peer)
        stopSpeakingDetection(mediaCall.peer)
      })
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
        if (hostStore.isMicActive && noiseProcessorRef.current) {
          manager.callWithStream(data.peerId, noiseProcessorRef.current.processedStream)
        }

        // Notify OTHER listeners about peerId change so they can re-establish voice calls
        const updatedUser = updatedUsers.find((u) => u.id === data.userId)
        if (updatedUser) {
          manager.broadcast(
            { type: 'user-joined', user: updatedUser, room: { users: updatedUsers }, newPeerId: data.peerId },
            data.peerId, // Exclude the reconnected peer itself
          )
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
      if (useSongShareStore.getState().isMicActive && noiseProcessorRef.current) {
        manager.callWithStream(data.peerId, noiseProcessorRef.current.processedStream)
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

      // If mic is active, call all peers now with the processed stream
      const store = useSongShareStore.getState()
      const procStream = noiseProcessorRef.current?.processedStream
      if (store.isMicActive && procStream) {
        data.peerIds.forEach((peerId) => {
          if (peerId !== manager.getMyPeerId()) {
            manager.callWithStream(peerId, procStream)
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

      // If mic is active, call the new peer with processed stream
      if (store.isMicActive && noiseProcessorRef.current) {
        manager.callWithStream(data.peerId, noiseProcessorRef.current.processedStream)
      }
    })

    /* ─── Event: voice-state-update (someone toggled mic) ── */
    const unsubVoiceState = manager.on('voice-state-update', (data: { userId: string; isMicActive: boolean; isMicMuted: boolean; senderPeerId?: string }) => {
      // Update local mic state tracking for this user
      setUserMicState(data.userId, { isMicActive: data.isMicActive, isMicMuted: data.isMicMuted })

      // If host, relay to all other listeners (exclude the original sender to avoid round-trip)
      if (manager.isHost) {
        manager.broadcast(
          { type: 'voice-state-update', userId: data.userId, isMicActive: data.isMicActive, isMicMuted: data.isMicMuted },
          data.senderPeerId,
        )
      }
    })

    /* ─── Event: playback-request (host executes action requested by a listener) ── */
    const unsubPlaybackRequest = manager.on('playback-request', (data: { action: 'play' | 'pause' | 'seek' | 'next' | 'previous'; seekTime?: number; senderPeerId?: string; username?: string }) => {
      if (!manager.isHost) return

      const state = useSongShareStore.getState()
      if (!state.room || state.room.currentTrackIndex < 0) return

      const audio = audioRef.current

      switch (data.action) {
        case 'play': {
          const currentTime = audio?.currentTime || 0
          audio?.play().catch(() => {})
          updateRoom({ isPlaying: true })
          manager.broadcast({ type: 'play', currentTime, sentAt: Date.now() })
          break
        }
        case 'pause': {
          const currentTime = audio?.currentTime || 0
          audio?.pause()
          updateRoom({ isPlaying: false })
          manager.broadcast({ type: 'pause', currentTime, sentAt: Date.now() })
          break
        }
        case 'seek': {
          if (data.seekTime != null && audio) {
            audio.currentTime = data.seekTime
            manager.broadcast({ type: 'seek', time: data.seekTime, sentAt: Date.now() })
          }
          break
        }
        case 'next': {
          if (state.room.currentTrackIndex < state.room.playlist.length - 1) {
            const newIndex = state.room.currentTrackIndex + 1
            const updated: RoomState = { ...state.room, currentTrackIndex: newIndex, currentTime: 0 }
            setRoom(updated)

            // Set up audio BEFORE broadcasting — ensures host audio is in flight
            // before guests receive the track-changed message
            const track = updated.playlist[newIndex]
            const url = track ? useSongShareStore.getState().audioCache.get(track.id) : null
            if (audio && url) {
              audio.src = url
              audio.currentTime = 0
              audio.playbackRate = 1.0
              audio.play().catch(() => {})
            }

            manager.broadcast({
              type: 'track-changed',
              currentTrackIndex: newIndex,
              currentTime: 0,
              playlist: updated.playlist,
              sentAt: Date.now(),
            })
          }
          break
        }
        case 'previous': {
          if (audio && audio.currentTime > 3) {
            audio.currentTime = 0
            manager.broadcast({ type: 'seek', time: 0, sentAt: Date.now() })
          } else if (state.room.currentTrackIndex > 0) {
            const newIndex = state.room.currentTrackIndex - 1
            const updated: RoomState = { ...state.room, currentTrackIndex: newIndex, currentTime: 0 }
            setRoom(updated)

            // Set up audio BEFORE broadcasting — ensures host audio is in flight
            // before guests receive the track-changed message
            const track = updated.playlist[newIndex]
            const url = track ? useSongShareStore.getState().audioCache.get(track.id) : null
            if (audio && url) {
              audio.src = url
              audio.currentTime = 0
              audio.playbackRate = 1.0
              audio.play().catch(() => {})
            }

            manager.broadcast({
              type: 'track-changed',
              currentTrackIndex: newIndex,
              currentTime: 0,
              playlist: updated.playlist,
              sentAt: Date.now(),
            })
          }
          break
        }
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

        // If mic is active, call the new peer with processed stream
        if (store.isMicActive && noiseProcessorRef.current) {
          manager.callWithStream(data.newPeerId, noiseProcessorRef.current.processedStream)
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

    const unsubPlay = manager.on('play', (data: { currentTime: number; sentAt?: number }) => {
      // Always compensate for play — the host IS advancing during message transit.
      // compensateTime(hostTime, sentAt) = hostTime + transit, which is where the host
      // actually is when the guest receives the message.
      const compensated = compensateTime(data.currentTime, data.sentAt, latencyRef.current)

      // Clear any previous pending play intent
      pendingPlayRef.current = null

      // Check if audio data for the current track is actually available
      const store = useSongShareStore.getState()
      const currentTrack = store.room?.playlist[store.room.currentTrackIndex]
      const trackUrl = currentTrack ? store.audioCache.get(currentTrack.id) : null
      const audio = audioRef.current

      if (trackUrl && audio && audio.src === trackUrl) {
        // Audio data is loaded and matches current track — play immediately
        updateRoom({ isPlaying: true, currentTime: compensated })
        audio.currentTime = compensated
        audio.playbackRate = 1.0
        audio.play().catch(() => {})
      } else {
        // Audio data NOT available yet — store play intent so the track-data-chunk
        // completion handler can calculate the correct start position when data arrives.
        // Don't update currentTime here to prevent stale values.
        pendingPlayRef.current = { hostTime: data.currentTime, receivedAt: Date.now() }
        updateRoom({ isPlaying: true, currentTime: compensated })
        // Don't try to play — audio isn't loaded yet (would fail silently and
        // leave audio.paused = true, preventing time-sync from running)
      }
    })

    const unsubPause = manager.on('pause', (data: { currentTime: number; sentAt?: number }) => {
      // NEVER compensate for pause — the host is STOPPED.
      // During transit, the guest continued playing for ~transit ms extra.
      // Seeking to the host's raw currentTime corrects this overshoot.
      // (compensating would put the guest AHEAD since host doesn't advance)
      const compensated = data.currentTime
      updateRoom({ isPlaying: false, currentTime: compensated })
      if (audioRef.current) {
        audioRef.current.currentTime = compensated
        audioRef.current.playbackRate = 1.0
        audioRef.current.pause()
      }
    })

    const unsubSeek = manager.on('seek', (data: { time: number; sentAt?: number }) => {
      // Always compensate for seek — the host IS advancing during message transit.
      const compensated = compensateTime(data.time, data.sentAt, latencyRef.current)
      updateRoom({ currentTime: compensated })
      if (audioRef.current) {
        audioRef.current.currentTime = compensated
        audioRef.current.playbackRate = 1.0
      }
    })

    const unsubSync = manager.on('time-sync', (data: { currentTime: number; sentAt?: number }) => {
      const audio = audioRef.current
      if (!audio || audio.paused) return

      // Use sentAt for accurate per-message transit time; fallback to RTT/2 estimate
      const compensatedHostTime = compensateTime(data.currentTime, data.sentAt, latencyRef.current)
      const drift = audio.currentTime - compensatedHostTime

      if (Math.abs(drift) > DRIFT_THRESHOLD_HARD) {
        // Large drift — hard seek to host position
        audio.currentTime = compensatedHostTime
        audio.playbackRate = 1.0
      } else if (Math.abs(drift) > DRIFT_THRESHOLD_SOFT) {
        // Moderate drift — smooth correction via playback rate adjustment.
        // If listener is AHEAD (drift > 0), play SLOWER to let host catch up.
        // If listener is BEHIND (drift < 0), play FASTER to catch up.
        // Target: correct the drift over ~7.5 seconds, capped at MAX_CORRECTION_RATE.
        const correctionMagnitude = Math.min(Math.abs(drift) / 7.5, MAX_CORRECTION_RATE)
        audio.playbackRate = 1.0 - Math.sign(drift) * correctionMagnitude
      } else {
        // Close enough — reset to normal rate
        if (audio.playbackRate !== 1.0) audio.playbackRate = 1.0
      }

      updateRoom({ currentTime: compensatedHostTime })
    })

    const unsubTrackChanged = manager.on('track-changed', (data: { currentTrackIndex: number; currentTime: number; playlist: Track[]; sentAt?: number }) => {
      // Always compensate for track changes — the host IS advancing during message transit.
      // The host now sets up audio BEFORE broadcasting (see onEnded, nextTrack, previousTrack),
      // so the audio is already playing when the message is sent — full compensation is safe.
      const compensated = compensateTime(data.currentTime, data.sentAt, latencyRef.current)

      // Clear any pending play intent — track-changed supersedes it
      pendingPlayRef.current = null

      updateRoom({
        currentTrackIndex: data.currentTrackIndex,
        currentTime: compensated,
        playlist: data.playlist,
      })
      const audio = audioRef.current
      if (!audio) return
      audio.playbackRate = 1.0 // Reset drift correction on track change
      audio.pause()
      audio.currentTime = 0
      const track = data.playlist[data.currentTrackIndex]
      if (track) {
        const url = useSongShareStore.getState().audioCache.get(track.id)
        if (url) {
          const wasPlaying = useSongShareStore.getState().room?.isPlaying
          audio.src = url
          // Wait for audio to be ready before seeking and resuming playback
          const onReady = () => {
            audio.removeEventListener('canplaythrough', onReady)
            audio.removeEventListener('canplay', onReady)
            audio.currentTime = compensated
            if (wasPlaying) audio.play().catch(() => {})
          }
          audio.addEventListener('canplaythrough', onReady)
          audio.addEventListener('canplay', onReady)
          // If already buffered (e.g. re-playing a cached track), start immediately
          if (audio.readyState >= 3) {
            audio.removeEventListener('canplaythrough', onReady)
            audio.removeEventListener('canplay', onReady)
            audio.currentTime = compensated
            if (wasPlaying) audio.play().catch(() => {})
          }
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
              const audio = audioRef.current
              audio.src = url
              if (st.room.isPlaying) {
                // Calculate the correct start position:
                // - If a 'play' event was received earlier but audio wasn't available,
                //   use pendingPlayRef to estimate where the host currently is
                //   (hostTime + elapsed time since play was received).
                // - Otherwise fall back to room.currentTime (set by the last
                //   play/seek/track-changed event).
                // This prevents starting from a stale position when data transfer
                // took time after the play command was issued.
                let startTime: number
                if (pendingPlayRef.current) {
                  const elapsed = (Date.now() - pendingPlayRef.current.receivedAt) / 1000
                  startTime = pendingPlayRef.current.hostTime + elapsed
                  pendingPlayRef.current = null
                } else {
                  startTime = st.room.currentTime || 0
                }
                audio.currentTime = startTime
                audio.play().catch(() => {})
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

    /* ─── Ping/Pong — RTT measurement ──────────── */

    // Host responds to pings immediately for latency estimation
    const unsubPing = manager.on('ping', (data: { t1: number; peerId: string }) => {
      manager.sendTo(data.peerId, { type: 'pong', t1: data.t1, t2: Date.now() })
    })

    // Listener processes pong to estimate one-way latency
    const unsubPong = manager.on('pong', (data: { t1: number; t2: number }) => {
      const t4 = Date.now()
      const rtt = t4 - data.t1
      const oneWay = rtt / 2
      // Median filter over last 10 samples for robustness against jitter outliers
      const history = latencyHistoryRef.current
      history.push(oneWay)
      if (history.length > 10) history.shift()
      const sorted = [...history].sort((a, b) => a - b)
      latencyRef.current = sorted[Math.floor(sorted.length / 2)]
    })

    /* ─── Chat ──────────────────────────────────── */

    const unsubChat = manager.on('chat-message', (data: { message: ChatMessage } | ChatMessage) => {
      const msg: ChatMessage = 'message' in data ? data.message : data
      const state = useSongShareStore.getState()
      updateRoom({ chatMessages: [...(state.room?.chatMessages || []), msg] })
    })

    /* ─── Conexão / desconexão do signaling ─────── */

    const unsubConnected = manager.on('connected', () => {
      setIsConnected(true)
      // Re-establish voice calls when signaling reconnects.
      // The signaling drop may have caused media calls to fail silently.
      // If mic is active, re-call all peers to restore voice connectivity.
      const store = useSongShareStore.getState()
      if (store.isMicActive && noiseProcessorRef.current) {
        const procStream = noiseProcessorRef.current.processedStream
        if (procStream) {
          const peerIds = store.allPeerIds
          peerIds.forEach((peerId) => {
            if (peerId !== manager.getMyPeerId()) {
              // hangupMedia first to clear stale entries, then re-call
              manager.hangupMedia(peerId)
              manager.callWithStream(peerId, procStream)
            }
          })
          console.log('[SongShare] Signaling reconnected, re-established voice calls to', peerIds.length - 1, 'peers')
        }
      }
    })
    const unsubDisconnected = manager.on('disconnected', () => setIsConnected(false))

    /* ─── Cleanup ───────────────────────────────── */

    return () => {
      ;[
        unsubIncomingCall, unsubMediaCallClosed,
        unsubJoin, unsubAccepted, unsubPeerList, unsubNewPeer, unsubVoiceState,
        unsubPlaybackRequest,
        unsubHostOff,
        unsubUserJoined, unsubUserLeft, unsubLeftReq, unsubListenerLost,
        unsubPlay, unsubPause, unsubSeek, unsubSync,
        unsubTrackChanged, unsubEnded, unsubPlaylist,
        unsubLyrics,
        unsubChunk, unsubReqData, unsubPing, unsubPong, unsubChat,
        unsubConnected, unsubDisconnected,
      ].forEach((fn) => fn?.())

      // Clean up speaking detection
      speakingIntervalsRef.current.forEach((interval) => clearInterval(interval))
      speakingIntervalsRef.current.clear()

      // Clean up per-peer AudioContext resume interaction listeners
      peerAudioCleanupRef.current.forEach((cleanup) => cleanup())
      peerAudioCleanupRef.current.clear()

      // Clean up local mic analysis AudioContext
      if (localMicAnalysisRef.current) {
        localMicAnalysisRef.current.source.disconnect()
        localMicAnalysisRef.current.audioContext.close().catch(() => {})
        localMicAnalysisRef.current = null
      }

      // Clean up silent answer stream AudioContext
      if (silentAnswerCtxRef.current) {
        silentAnswerCtxRef.current.close().catch(() => {})
        silentAnswerCtxRef.current = null
        silentAnswerStreamRef.current = null
      }

      // Clean up noise processor
      if (noiseProcessorRef.current) {
        clearInterval(noiseProcessorRef.current.cleanupInterval)
        noiseProcessorRef.current.source.disconnect()
        noiseProcessorRef.current.highPass.disconnect()
        noiseProcessorRef.current.noiseGate.disconnect()
        noiseProcessorRef.current.destination.disconnect()
        noiseProcessorRef.current.audioContext.close().catch(() => {})
        noiseProcessorRef.current = null
      }

      manager.disconnect()
      if (timeSyncRef.current) clearInterval(timeSyncRef.current)
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)
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
        manager.broadcast({ type: 'time-sync', currentTime: audio.currentTime, sentAt: Date.now() })
      }
    }, SYNC_INTERVAL)

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
          const newIndex = st.room.currentTrackIndex + 1
          const updated = { ...st.room, currentTrackIndex: newIndex, currentTime: 0 }
          useSongShareStore.getState().setRoom(updated)

          // CRITICAL: Set up audio BEFORE broadcasting to guests.
          // Previously, the broadcast went out first and the React useEffect
          // set up audio later (~16-50ms delay). This meant the host hadn't
          // started playing when the message was sent, causing guests to be
          // ahead when full compensation was applied. By setting up audio
          // synchronously here, the audio.play() call is in flight before the
          // broadcast — guests receive the message after the host's audio has
          // (or is about to) start, making full latency compensation accurate.
          const nextTrack = updated.playlist[newIndex]
          const url = nextTrack ? useSongShareStore.getState().audioCache.get(nextTrack.id) : null
          if (audio && url) {
            audio.src = url
            audio.currentTime = 0
            audio.playbackRate = 1.0
            audio.play().catch(() => {})
          }

          mgr.broadcast({
            type: 'track-changed',
            currentTrackIndex: newIndex,
            currentTime: 0,
            playlist: updated.playlist,
            sentAt: Date.now(),
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
        // If a play was pending (audio wasn't available when play event arrived),
        // calculate host's estimated current position instead of using stale room.currentTime.
        // Otherwise use room.currentTime which was set by the most recent play/seek event.
        let startTime: number
        if (pendingPlayRef.current) {
          const elapsed = (Date.now() - pendingPlayRef.current.receivedAt) / 1000
          startTime = pendingPlayRef.current.hostTime + elapsed
          pendingPlayRef.current = null
        } else {
          startTime = room.currentTime || 0
        }
        audio.currentTime = startTime
        audio.play().catch(() => {})
      }
    }
  }, [room?.currentTrackIndex, room?.isPlaying])

  /* ── Voice call health check ────────────────────── */
  // Periodically verify that voice calls are alive. If mic is active but
  // mediaCalls are missing for known peers (e.g., due to ICE failure or
  // signaling drop), re-initiate the calls.
  useEffect(() => {
    const manager = managerRef.current
    if (!manager) return

    const interval = setInterval(() => {
      const store = useSongShareStore.getState()
      if (!store.isMicActive || !noiseProcessorRef.current) return
      if (!store.room) return

      const procStream = noiseProcessorRef.current.processedStream
      if (!procStream) return

      // Check each known peer — if we don't have a media call for them, try to establish one
      store.allPeerIds.forEach((peerId) => {
        if (peerId === manager.getMyPeerId()) return
        if (!manager.mediaCalls.has(peerId)) {
          // No active media call for this peer — try to establish
          const call = manager.callWithStream(peerId, procStream)
          if (call) {
            console.log('[SongShare] Voice health check: re-established call to', peerId)
          }
        }
      })
    }, 10000) // Check every 10 seconds

    return () => clearInterval(interval)
  }, [room?.hostId])

  /* ── RTT measurement (listener pings host) ────── */

  useEffect(() => {
    const manager = managerRef.current
    if (!manager || !room?.hostId || manager.isHost) {
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null }
      return
    }

    // Send first ping immediately, then every PING_INTERVAL
    manager.sendToHost({ type: 'ping', t1: Date.now() })

    pingIntervalRef.current = setInterval(() => {
      manager.sendToHost({ type: 'ping', t1: Date.now() })
    }, PING_INTERVAL)

    return () => {
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null }
    }
  }, [room?.hostId])

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

    // Revoke blob URL to prevent memory leak
    revokeAudioUrl(trackId)
  }, [setRoom, revokeAudioUrl])

  const play = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return
    const audio = audioRef.current
    const currentTime = audio?.currentTime || 0

    audio?.play().catch(() => {})
    updateRoom({ isPlaying: true })
    manager.broadcast({ type: 'play', currentTime, sentAt: Date.now() })
  }, [updateRoom])

  const pause = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return
    const audio = audioRef.current
    const currentTime = audio?.currentTime || 0

    audio?.pause()
    updateRoom({ isPlaying: false })
    manager.broadcast({ type: 'pause', currentTime, sentAt: Date.now() })
  }, [updateRoom])

  const seek = useCallback((time: number) => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return

    if (audioRef.current) audioRef.current.currentTime = time
    manager.broadcast({ type: 'seek', time, sentAt: Date.now() })
  }, [])

  const nextTrack = useCallback(() => {
    const manager = managerRef.current!
    const state = useSongShareStore.getState()
    if (!manager.isHost || !state.room) return

    if (state.room.currentTrackIndex < state.room.playlist.length - 1) {
      const newIndex = state.room.currentTrackIndex + 1
      const updated: RoomState = { ...state.room, currentTrackIndex: newIndex, currentTime: 0 }
      setRoom(updated)

      // Set up audio BEFORE broadcasting — ensures host audio is in flight
      // before guests receive the track-changed message
      const track = updated.playlist[newIndex]
      const url = track ? useSongShareStore.getState().audioCache.get(track.id) : null
      const audio = audioRef.current
      if (audio && url) {
        audio.src = url
        audio.currentTime = 0
        audio.playbackRate = 1.0
        audio.play().catch(() => {})
      }

      manager.broadcast({
        type: 'track-changed',
        currentTrackIndex: newIndex,
        currentTime: 0,
        playlist: updated.playlist,
        sentAt: Date.now(),
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
      manager.broadcast({ type: 'seek', time: 0, sentAt: Date.now() })
    } else if (state.room.currentTrackIndex > 0) {
      const newIndex = state.room.currentTrackIndex - 1
      const updated: RoomState = { ...state.room, currentTrackIndex: newIndex, currentTime: 0 }
      setRoom(updated)

      // Set up audio BEFORE broadcasting — ensures host audio is in flight
      // before guests receive the track-changed message
      const track = updated.playlist[newIndex]
      const url = track ? useSongShareStore.getState().audioCache.get(track.id) : null
      if (audio && url) {
        audio.src = url
        audio.currentTime = 0
        audio.playbackRate = 1.0
        audio.play().catch(() => {})
      }

      manager.broadcast({
        type: 'track-changed',
        currentTrackIndex: newIndex,
        currentTime: 0,
        playlist: updated.playlist,
        sentAt: Date.now(),
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
      setLocalSpeaking(false)
      manager.hangupAllMedia()

      // Clean up local mic speaking detection
      if (localMicAnalysisRef.current) {
        localMicAnalysisRef.current.source.disconnect()
        localMicAnalysisRef.current.audioContext.close().catch(() => {})
        localMicAnalysisRef.current = null
      }
      const localInterval = speakingIntervalsRef.current.get('__local__')
      if (localInterval) {
        clearInterval(localInterval)
        speakingIntervalsRef.current.delete('__local__')
      }

      // Clean up noise processor
      if (noiseProcessorRef.current) {
        clearInterval(noiseProcessorRef.current.cleanupInterval)
        noiseProcessorRef.current.source.disconnect()
        noiseProcessorRef.current.highPass.disconnect()
        noiseProcessorRef.current.noiseGate.disconnect()
        noiseProcessorRef.current.destination.disconnect()
        noiseProcessorRef.current.audioContext.close().catch(() => {})
        noiseProcessorRef.current = null
      }

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
          senderPeerId: manager.getMyPeerId(),
        })
      }
    } else {
      // Activate mic
      try {
        // Create AudioContext BEFORE the async getUserMedia call while we're
        // still in the user gesture context. On iOS Safari, the gesture context
        // can be consumed by the await, leaving a subsequently-created AudioContext
        // permanently suspended.
        const procCtx = new AudioContext()

        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })

        // Ensure the context is running before setting up the processing chain.
        // In some browsers, resume() resolves immediately even if the context
        // hasn't transitioned to 'running' yet. Verify the actual state.
        await procCtx.resume()
        if (procCtx.state !== 'running') {
          // Retry with a longer wait — some browsers need extra time
          await new Promise<void>((resolve) => {
            const check = () => {
              if (procCtx.state === 'running') { resolve(); return }
              procCtx.resume().then(() => {
                if (procCtx.state === 'running') resolve()
                else setTimeout(check, 100)
              }).catch(() => setTimeout(check, 100))
            }
            setTimeout(check, 100)
            // Timeout after 3 seconds — proceed anyway
            setTimeout(resolve, 3000)
          })
        }
        console.log('[SongShare] procCtx state after resume:', procCtx.state)
        const procSource = procCtx.createMediaStreamSource(rawStream)

        // 1) High-pass filter: removes AC hum (~50/60Hz), wind noise, low rumble
        const highPass = procCtx.createBiquadFilter()
        highPass.type = 'highpass'
        highPass.frequency.value = HIGH_PASS_FREQ
        highPass.Q.value = 0.7 // gentle slope, no resonance artifacts

        // 2) Noise gate: smoothly attenuates audio when volume is below threshold.
        //    Uses hysteresis (different open/close thresholds) to prevent rapid toggling.
        //    Ramp times are asymmetric: fast attack (10ms) to never clip word starts,
        //    slow release (150ms) for natural decay without click artifacts.
        const noiseGate = procCtx.createGain()
        noiseGate.gain.value = 0 // start closed

        // Analyser for noise gate volume detection (separate from speaking detection)
        const gateAnalyser = procCtx.createAnalyser()
        gateAnalyser.fftSize = 512
        gateAnalyser.smoothingTimeConstant = 0.5 // faster response than speaking detection

        const gateData = new Uint8Array(gateAnalyser.frequencyBinCount)
        let gateOpen = false
        let holdUntil = 0 // timestamp to hold gate open

        // Noise gate control loop (runs at ~7Hz — efficient, no audio artifacts)
        const cleanupInterval = setInterval(() => {
          if (!useSongShareStore.getState().isMicActive) return
          // Don't open gate when muted — prevents audio leaking through
          if (useSongShareStore.getState().isMicMuted) return

          gateAnalyser.getByteFrequencyData(gateData)
          let sum = 0
          for (let i = 0; i < gateData.length; i++) sum += gateData[i]
          const volume = sum / gateData.length / 255
          const now = performance.now()

          if (!gateOpen) {
            // Gate closed — check if volume exceeds open threshold
            if (volume > NOISE_GATE_OPEN_THRESHOLD) {
              gateOpen = true
              holdUntil = now + NOISE_GATE_HOLD_MS
              // Fast attack: ramp to 1.0 over NOISE_GATE_ATTACK_MS
              noiseGate.gain.cancelScheduledValues(procCtx.currentTime)
              noiseGate.gain.setValueAtTime(noiseGate.gain.value, procCtx.currentTime)
              noiseGate.gain.linearRampToValueAtTime(1.0, procCtx.currentTime + NOISE_GATE_ATTACK_MS / 1000)
            }
          } else {
            // Gate open — check if volume dropped below close threshold
            if (volume < NOISE_GATE_CLOSE_THRESHOLD) {
              if (now < holdUntil) {
                // Still in hold period — keep gate open
              } else {
                // Release: smooth ramp to 0 over NOISE_GATE_RELEASE_MS
                gateOpen = false
                noiseGate.gain.cancelScheduledValues(procCtx.currentTime)
                noiseGate.gain.setValueAtTime(noiseGate.gain.value, procCtx.currentTime)
                noiseGate.gain.linearRampToValueAtTime(0, procCtx.currentTime + NOISE_GATE_RELEASE_MS / 1000)
              }
            } else {
              // Volume still above threshold — reset hold timer
              holdUntil = now + NOISE_GATE_HOLD_MS
            }
          }
        }, 150)

        // Connect processing chain
        procSource.connect(highPass)
        highPass.connect(noiseGate)
        highPass.connect(gateAnalyser) // tap for volume detection (doesn't affect audio path)

        // Create destination for processed output
        const dest = procCtx.createMediaStreamDestination()
        noiseGate.connect(dest)
        const processedStreamFinal = dest.stream

        // Store processor ref for cleanup
        noiseProcessorRef.current = {
          audioContext: procCtx,
          source: procSource,
          highPass,
          noiseGate,
          destination: dest,
          processedStream: processedStreamFinal,
          cleanupInterval,
        }

        // Store raw stream reference (needed for track cleanup)
        setMicStream(rawStream)
        setMicActive(true)
        setMicMuted(false)

        // ── Speaking detection (on raw stream, independent of noise gate) ──
        const analysisCtx = new AudioContext()
        // Resume for reliable speaking detection (may be suspended after async getUserMedia).
        analysisCtx.resume().catch(() => {})
        const analysisSource = analysisCtx.createMediaStreamSource(rawStream)
        const analyser = analysisCtx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.8
        analysisSource.connect(analyser) // NOT connected to output — no echo
        localMicAnalysisRef.current = { audioContext: analysisCtx, source: analysisSource, analyser }

        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const localInterval = setInterval(() => {
          if (!useSongShareStore.getState().isMicActive || useSongShareStore.getState().isMicMuted) {
            setLocalSpeaking(false)
            return
          }
          analyser.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
          const average = sum / dataArray.length / 255
          setLocalSpeaking(average > SPEAKING_THRESHOLD)
        }, 150)
        speakingIntervalsRef.current.set('__local__', localInterval)

        // Call all known peers with the PROCESSED stream (not raw)
        const peerIds = store.allPeerIds
        peerIds.forEach((peerId) => {
          if (peerId !== manager.getMyPeerId()) {
            manager.callWithStream(peerId, processedStreamFinal)
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
            senderPeerId: manager.getMyPeerId(),
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

    // Method 1: Disable raw mic tracks (standard WebRTC approach)
    store.micStream.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted
    })

    // Method 2: Directly control noise gate gain for IMMEDIATE, reliable muting.
    // Some browsers may not silence MediaStreamAudioSourceNode when track.enabled=false.
    // Forcing the gate closed ensures the processed stream is silent regardless.
    if (noiseProcessorRef.current) {
      const ctx = noiseProcessorRef.current.audioContext
      const gate = noiseProcessorRef.current.noiseGate
      if (newMuted) {
        // Force gate closed immediately (10ms ramp to avoid click artifact)
        gate.gain.cancelScheduledValues(ctx.currentTime)
        gate.gain.setValueAtTime(gate.gain.value, ctx.currentTime)
        gate.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.01)
      }
      // When unmuting, do NOT force the gate open — let the cleanup interval
      // open it naturally when speech is detected. This avoids sending noise.
    }

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
        senderPeerId: manager.getMyPeerId(),
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

  /** Leave room properly — notify host before disconnecting. */
  const leaveRoom = useCallback(() => {
    const manager = managerRef.current
    if (!manager) return

    const store = useSongShareStore.getState()
    if (!store.room || manager.isHost) {
      // Host just resets — no one to notify
      if (store.micStream) store.micStream.getTracks().forEach((t) => t.stop())
      manager.disconnect()
      reset()
      return
    }

    // Listener: send explicit leave request to host so they update immediately
    // (instead of waiting for the slow WebRTC connection timeout)
    try {
      manager.sendToHost({
        type: 'user-left-request',
        userId: manager.userId,
        peerId: manager.getMyPeerId(),
      })
    } catch {
      // Connection may already be broken — that's ok
    }

    // Clean up mic
    if (store.micStream) store.micStream.getTracks().forEach((t) => t.stop())

    // Disconnect and reset
    manager.disconnect()
    reset()
  }, [reset])

  /* ── Playback request (listeners ask host to control playback) ── */

  const requestPlayback = useCallback((action: 'play' | 'pause' | 'next' | 'previous' | 'seek', seekTime?: number) => {
    const manager = managerRef.current!
    if (manager.isHost) return // Host executes directly via play/pause/seek/nextTrack/previousTrack

    const state = useSongShareStore.getState()
    if (!state.room || state.room.currentTrackIndex < 0) return

    if (action === 'seek') {
      manager.sendToHost({
        type: 'playback-request',
        action: 'seek',
        seekTime,
        username: username.trim(),
      })
    } else {
      manager.sendToHost({
        type: 'playback-request',
        action,
        username: username.trim(),
      })
    }
  }, [username])

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
    requestPlayback,
    sendChatMessage,
    updateTrackLyrics,
    // Voice chat
    toggleMic,
    toggleMute,
    setPeerVolume,
    resyncIsConnected,
    leaveRoom,
  }
}
