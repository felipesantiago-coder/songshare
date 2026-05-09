import { create } from 'zustand'

// ─── Types ──────────────────────────────────────────────
export interface VoiceStreamInfo {
  stream: MediaStream
  audioElement: HTMLAudioElement
  analyser?: AnalyserNode
  analysisContext?: AudioContext
  volume: number
  isSpeaking: boolean
}

export interface RoomUser {
  id: string
  username: string
  isHost: boolean
  peerId?: string // PeerJS peer ID for voice chat
}

export interface Track {
  id: string
  name: string
  artist: string
  duration: number
  addedBy: string
  addedAt: number
  lyrics: string
}

export interface ChatMessage {
  id: string
  username: string
  content: string
  timestamp: number
  type: 'user' | 'system'
}

export interface RoomState {
  code: string
  hostId: string
  users: RoomUser[]
  playlist: Track[]
  currentTrackIndex: number
  isPlaying: boolean
  currentTime: number
  chatMessages: ChatMessage[]
}

type AppPhase = 'landing' | 'room'

// ─── Store ──────────────────────────────────────────────
interface SongShareStore {
  // App state
  phase: AppPhase
  username: string
  roomCode: string
  socket: any | null
  isConnected: boolean

  // Room state
  room: RoomState | null

  // Audio data cache (trackId -> blob URL)
  audioCache: Map<string, string>

  // Track data chunks being assembled
  pendingChunks: Map<string, ArrayBuffer[]>

  // UI state
  showChat: boolean
  showLyrics: boolean
  showVoicePanel: boolean
  isDragOver: boolean
  // Edit lyrics dialog
  editingLyricsTrackId: string | null

  // Voice chat state
  isMicActive: boolean
  isMicMuted: boolean
  isLocalSpeaking: boolean
  micStream: MediaStream | null
  voiceStreams: Map<string, VoiceStreamInfo>
  allPeerIds: string[] // All peer IDs in room (including host)
  // Per-user mic state (userId -> { isMicActive, isMicMuted })
  userMicStates: Map<string, { isMicActive: boolean; isMicMuted: boolean }>

  // Actions
  setPhase: (phase: AppPhase) => void
  setUsername: (username: string) => void
  setRoomCode: (code: string) => void
  setSocket: (socket: any) => void
  setIsConnected: (connected: boolean) => void
  setRoom: (room: RoomState | null) => void
  updateRoom: (partial: Partial<RoomState>) => void

  // Audio cache actions
  setAudioUrl: (trackId: string, url: string) => void
  getAudioUrl: (trackId: string) => string | undefined
  revokeAudioUrl: (trackId: string) => void
  revokeAllAudioUrls: () => void

  // Track data chunk management
  addChunk: (trackId: string, chunkIndex: number, totalChunks: number, data: ArrayBuffer) => void
  getAssembledBlob: (trackId: string) => ArrayBuffer | null
  clearPendingChunks: (trackId: string) => void

  // UI actions
  setShowChat: (show: boolean) => void
  setShowLyrics: (show: boolean) => void
  setShowVoicePanel: (show: boolean) => void
  setIsDragOver: (dragOver: boolean) => void
  setEditingLyricsTrackId: (trackId: string | null) => void

  // Voice chat actions
  setMicActive: (active: boolean) => void
  setMicMuted: (muted: boolean) => void
  setMicStream: (stream: MediaStream | null) => void
  setLocalSpeaking: (speaking: boolean) => void
  addVoiceStream: (peerId: string, info: VoiceStreamInfo) => void
  removeVoiceStream: (peerId: string) => void
  setVoiceStreamVolume: (peerId: string, volume: number) => void
  setVoiceStreamSpeaking: (peerId: string, speaking: boolean) => void
  clearVoiceStreams: () => void
  setAllPeerIds: (peerIds: string[]) => void
  setUserMicState: (userId: string, state: { isMicActive: boolean; isMicMuted: boolean }) => void
  removeUserMicState: (userId: string) => void

  // Reset
  reset: () => void
}

const initialState = {
  phase: 'landing' as AppPhase,
  username: '',
  roomCode: '',
  socket: null,
  isConnected: false,
  room: null,
  audioCache: new Map<string, string>(),
  pendingChunks: new Map<string, ArrayBuffer[]>(),
  showChat: false,
  showLyrics: false,
  showVoicePanel: false,
  isDragOver: false,
  editingLyricsTrackId: null,
  isMicActive: false,
  isMicMuted: false,
  isLocalSpeaking: false,
  micStream: null,
  voiceStreams: new Map<string, VoiceStreamInfo>(),
  allPeerIds: [],
  userMicStates: new Map<string, { isMicActive: boolean; isMicMuted: boolean }>(),
}

export const useSongShareStore = create<SongShareStore>((set, get) => ({
  ...initialState,

  setPhase: (phase) => set({ phase }),
  setUsername: (username) => set({ username }),
  setRoomCode: (code) => set({ roomCode: code }),
  setSocket: (socket) => set({ socket }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setRoom: (room) => set({ room }),

  updateRoom: (partial) =>
    set((state) => ({
      room: state.room ? { ...state.room, ...partial } : null,
    })),

  setAudioUrl: (trackId, url) =>
    set((state) => {
      // Revoke old blob URL if replacing (prevent memory leak)
      const oldUrl = state.audioCache.get(trackId)
      if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl)
      const newCache = new Map(state.audioCache)
      newCache.set(trackId, url)
      return { audioCache: newCache }
    }),

  getAudioUrl: (trackId) => get().audioCache.get(trackId),

  revokeAudioUrl: (trackId) =>
    set((state) => {
      const url = state.audioCache.get(trackId)
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
      const newCache = new Map(state.audioCache)
      newCache.delete(trackId)
      return { audioCache: newCache }
    }),

  revokeAllAudioUrls: () => {
    const cache = get().audioCache
    cache.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    })
  },

  addChunk: (trackId, chunkIndex, totalChunks, data) =>
    set((state) => {
      const newPending = new Map(state.pendingChunks)
      let chunks = newPending.get(trackId) || []
      // Ensure array is large enough
      while (chunks.length < totalChunks) {
        chunks.push(new ArrayBuffer(0))
      }
      chunks[chunkIndex] = data
      newPending.set(trackId, chunks)
      return { pendingChunks: newPending }
    }),

  getAssembledBlob: (trackId) => {
    const chunks = get().pendingChunks.get(trackId)
    if (!chunks || chunks.length === 0) return null
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }
    return result.buffer
  },

  clearPendingChunks: (trackId) =>
    set((state) => {
      const newPending = new Map(state.pendingChunks)
      newPending.delete(trackId)
      return { pendingChunks: newPending }
    }),

  setShowChat: (show) => set({ showChat: show }),
  setShowLyrics: (show) => set({ showLyrics: show }),
  setShowVoicePanel: (show) => set({ showVoicePanel: show }),
  setIsDragOver: (dragOver) => set({ isDragOver: dragOver }),
  setEditingLyricsTrackId: (trackId) => set({ editingLyricsTrackId: trackId }),

  setMicActive: (active) => set({ isMicActive: active }),
  setMicMuted: (muted) => set({ isMicMuted: muted }),
  setMicStream: (stream) => set({ micStream: stream }),
  setLocalSpeaking: (speaking) => set({ isLocalSpeaking: speaking }),
  addVoiceStream: (peerId, info) =>
    set((state) => {
      const newMap = new Map(state.voiceStreams)
      newMap.set(peerId, info)
      return { voiceStreams: newMap }
    }),
  removeVoiceStream: (peerId) =>
    set((state) => {
      const info = state.voiceStreams.get(peerId)
      if (info) {
        info.gainNode.disconnect()
        info.audioContext.close().catch(() => {})
        info.stream.getTracks().forEach((t) => t.stop())
      }
      const newMap = new Map(state.voiceStreams)
      newMap.delete(peerId)
      return { voiceStreams: newMap }
    }),
  setVoiceStreamVolume: (peerId, volume) =>
    set((state) => {
      const info = state.voiceStreams.get(peerId)
      if (!info) return state // Defensive: no crash if peer doesn't exist
      info.audioElement.volume = volume
      const newMap = new Map(state.voiceStreams)
      newMap.set(peerId, { ...info, volume })
      return { voiceStreams: newMap }
    }),
  setVoiceStreamSpeaking: (peerId, speaking) =>
    set((state) => {
      const info = state.voiceStreams.get(peerId)
      if (!info) return state
      const newMap = new Map(state.voiceStreams)
      newMap.set(peerId, { ...info, isSpeaking: speaking })
      return { voiceStreams: newMap }
    }),
  clearVoiceStreams: () => {
    const streams = get().voiceStreams
    streams.forEach((info) => {
      info.audioElement.pause()
      info.audioElement.srcObject = null
      info.analysisContext?.close().catch(() => {})
    })
    set({ voiceStreams: new Map() })
  },
  setAllPeerIds: (peerIds) => set({ allPeerIds: peerIds }),
  setUserMicState: (userId, micState) =>
    set((state) => {
      const newMap = new Map(state.userMicStates)
      newMap.set(userId, micState)
      return { userMicStates: newMap }
    }),
  removeUserMicState: (userId) =>
    set((state) => {
      const newMap = new Map(state.userMicStates)
      newMap.delete(userId)
      return { userMicStates: newMap }
    }),

  reset: () => {
    const streams = get().voiceStreams
    streams.forEach((info) => {
      info.audioElement.pause()
      info.audioElement.srcObject = null
      info.analysisContext?.close().catch(() => {})
    })
    const micStream = get().micStream
    if (micStream) micStream.getTracks().forEach((t) => t.stop())

    // Revoke all blob URLs to prevent memory leak on room leave
    get().audioCache.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    })

    set({
      ...initialState,
      audioCache: new Map<string, string>(),
      pendingChunks: new Map<string, ArrayBuffer[]>(),
      voiceStreams: new Map<string, VoiceStreamInfo>(),
      micStream: null,
    })
  },
}))
