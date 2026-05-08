'use client'

import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useSongShareStore } from '@/store/songshare'
import type { RoomState, Track } from '@/store/songshare'

const CHUNK_SIZE = 512 * 1024 // 512KB chunks

export function useSongShareSocket() {
  const {
    socket,
    setSocket,
    setIsConnected,
    setRoom,
    updateRoom,
    setPhase,
    setRoomCode,
    audioCache,
    setAudioUrl,
    addChunk,
    getAssembledBlob,
    clearPendingChunks,
    room,
    username,
  } = useSongShareStore()

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timeSyncInterval = useRef<NodeJS.Timeout | null>(null)
  const chunksReceivedCount = useRef<Map<string, number>>(new Map())

  // Connect to Socket.io server
  useEffect(() => {
    const socketInstance: Socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 15000,
    })

    socketInstance.on('connect', () => {
      console.log('[SongShare] Connected to server')
      setIsConnected(true)
    })

    socketInstance.on('disconnect', () => {
      console.log('[SongShare] Disconnected from server')
      setIsConnected(false)
    })

    socketInstance.on('connect_error', (error) => {
      console.error('[SongShare] Connection error:', error)
      setIsConnected(false)
    })

    // ─── Room Events ──────────────────────────────────
    socketInstance.on('room-created', (data: { code: string; room: RoomState }) => {
      setRoom(data.room)
      setRoomCode(data.code)
      setPhase('room')
    })

    socketInstance.on('room-joined', (data: { room: RoomState }) => {
      setRoom(data.room)
      setRoomCode(data.room.code)
      setPhase('room')
    })

    socketInstance.on('room-error', (data: { message: string }) => {
      alert(data.message)
    })

    // ─── User Events ──────────────────────────────────
    socketInstance.on('user-joined', (data: { user: any; room: Partial<RoomState> }) => {
      updateRoom(data.room)
    })

    socketInstance.on('user-left', (data: { user: any; room: Partial<RoomState> }) => {
      updateRoom(data.room)
    })

    socketInstance.on('host-changed', (data: { newHostId: string; room: RoomState }) => {
      setRoom(data.room)
    })

    // ─── Playlist Events ──────────────────────────────
    socketInstance.on('playlist-updated', (data: Partial<RoomState>) => {
      updateRoom(data)
    })

    socketInstance.on('track-changed', (data: Partial<RoomState>) => {
      updateRoom(data)
      // Stop current audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
      // Try to play new track
      if (data.currentTrackIndex !== undefined && data.playlist) {
        const track = data.playlist[data.currentTrackIndex]
        if (track) {
          const url = useSongShareStore.getState().audioCache.get(track.id)
          if (url && audioRef.current) {
            audioRef.current.src = url
            if (data.currentTime !== undefined) {
              audioRef.current.currentTime = data.currentTime
            }
          }
        }
      }
    })

    socketInstance.on('playlist-ended', () => {
      updateRoom({ isPlaying: false, currentTime: 0 })
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    })

    // ─── Playback Events (received by non-host users) ─
    socketInstance.on('play', (data: { currentTime: number }) => {
      updateRoom({ isPlaying: true, currentTime: data.currentTime })
      if (audioRef.current) {
        if (Math.abs(audioRef.current.currentTime - data.currentTime) > 1.5) {
          audioRef.current.currentTime = data.currentTime
        }
        audioRef.current.play().catch(() => {})
      }
    })

    socketInstance.on('pause', (data: { currentTime: number }) => {
      updateRoom({ isPlaying: false, currentTime: data.currentTime })
      if (audioRef.current) {
        audioRef.current.pause()
      }
    })

    socketInstance.on('seek', (data: { time: number }) => {
      updateRoom({ currentTime: data.time })
      if (audioRef.current) {
        audioRef.current.currentTime = data.time
      }
    })

    socketInstance.on('time-sync', (data: { currentTime: number }) => {
      updateRoom({ currentTime: data.currentTime })
      if (audioRef.current && !audioRef.current.paused) {
        if (Math.abs(audioRef.current.currentTime - data.currentTime) > 2) {
          audioRef.current.currentTime = data.currentTime
        }
      }
    })

    // ─── Track Data Transfer ──────────────────────────
    socketInstance.on('track-data-chunk', (data: {
      trackId: string
      chunkIndex: number
      totalChunks: number
      data: ArrayBuffer
    }) => {
      addChunk(data.trackId, data.chunkIndex, data.totalChunks, data.data)

      // Track progress
      const counts = chunksReceivedCount.current
      if (!counts.has(data.trackId)) {
        counts.set(data.trackId, 0)
      }
      counts.set(data.trackId, counts.get(data.trackId)! + 1)

      // Check if all chunks received
      if (counts.get(data.trackId) >= data.totalChunks) {
        const assembled = getAssembledBlob(data.trackId)
        if (assembled) {
          const blob = new Blob([assembled], { type: 'audio/mpeg' })
          const url = URL.createObjectURL(blob)
          setAudioUrl(data.trackId, url)

          // If this is the current track, start playing
          const state = useSongShareStore.getState()
          if (state.room) {
            const currentTrack = state.room.playlist[state.room.currentTrackIndex]
            if (currentTrack && currentTrack.id === data.trackId && audioRef.current) {
              audioRef.current.src = url
              if (state.room.isPlaying) {
                audioRef.current.currentTime = state.room.currentTime
                audioRef.current.play().catch(() => {})
              }
            }
          }
        }
        clearPendingChunks(data.trackId)
        counts.delete(data.trackId)
      }
    })

    // Request to re-send track data (for users who just joined)
    socketInstance.on('request-track-data', (data: { trackId: string; requestedBy: string }) => {
      const state = useSongShareStore.getState()
      if (!state.room || state.room.hostId !== socketInstance.id) return

      const url = state.audioCache.get(data.trackId)
      if (!url) return

      // Re-send the track data
      fetch(url)
        .then(res => res.arrayBuffer())
        .then(buffer => {
          const uint8 = new Uint8Array(buffer)
          const totalChunks = Math.ceil(uint8.byteLength / CHUNK_SIZE)

          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, uint8.byteLength)
            const chunk = uint8.slice(start, end).buffer

            socketInstance.emit('share-track-data', {
              trackId: data.trackId,
              chunkIndex: i,
              totalChunks,
              data: chunk,
            })
          }
        })
        .catch(console.error)
    })

    // ─── Chat Events ──────────────────────────────────
    socketInstance.on('chat-message', (message: any) => {
      updateRoom({
        chatMessages: [...(useSongShareStore.getState().room?.chatMessages || []), message],
      })
    })

    setSocket(socketInstance)

    return () => {
      socketInstance.disconnect()
      if (timeSyncInterval.current) {
        clearInterval(timeSyncInterval.current)
      }
    }
  }, [])

  // Host time sync interval
  useEffect(() => {
    if (room && room.hostId === socket?.id && room.isPlaying && audioRef.current) {
      if (timeSyncInterval.current) clearInterval(timeSyncInterval.current)
      timeSyncInterval.current = setInterval(() => {
        if (audioRef.current && socket) {
          socket.emit('time-sync', { currentTime: audioRef.current.currentTime })
        }
      }, 3000)
    } else {
      if (timeSyncInterval.current) {
        clearInterval(timeSyncInterval.current)
        timeSyncInterval.current = null
      }
    }

    return () => {
      if (timeSyncInterval.current) {
        clearInterval(timeSyncInterval.current)
      }
    }
  }, [room?.isPlaying, room?.hostId, socket])

  // ─── Actions ─────────────────────────────────────────

  const createRoom = useCallback(() => {
    if (socket && username.trim()) {
      socket.emit('create-room', { username: username.trim() })
    }
  }, [socket, username])

  const joinRoom = useCallback((code: string) => {
    if (socket && username.trim()) {
      socket.emit('join-room', { code: code.toUpperCase(), username: username.trim() })
    }
  }, [socket, username])

  const addTrack = useCallback(async (file: File) => {
    if (!socket || !room) return

    const trackId = Math.random().toString(36).substring(2, 11)

    // Read file metadata
    const name = file.name.replace(/\.[^.]+$/, '')
    const duration = await new Promise<number>((resolve) => {
      const tempAudio = new Audio()
      tempAudio.src = URL.createObjectURL(file)
      tempAudio.addEventListener('loadedmetadata', () => {
        resolve(tempAudio.duration)
        URL.revokeObjectURL(tempAudio.src)
      })
      tempAudio.addEventListener('error', () => resolve(0))
    })

    const track: Track = {
      id: trackId,
      name,
      artist: username,
      duration,
      addedBy: username,
      addedAt: Date.now(),
    }

    socket.emit('add-track', { track })

    // Store local copy immediately
    const blobUrl = URL.createObjectURL(file)
    setAudioUrl(trackId, blobUrl)

    // If this is the first track, set up the audio element
    if (room.playlist.length === 0 && audioRef.current) {
      audioRef.current.src = blobUrl
    }

    // Send file data to other users in chunks
    const buffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(buffer)
    const totalChunks = Math.ceil(uint8.byteLength / CHUNK_SIZE)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, uint8.byteLength)
      const chunk = uint8.slice(start, end).buffer

      socket.emit('share-track-data', {
        trackId,
        chunkIndex: i,
        totalChunks,
        data: chunk,
      })

      // Small delay between chunks to avoid overwhelming the connection
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }, [socket, room, username, setAudioUrl])

  const removeTrack = useCallback((trackId: string) => {
    if (socket && room?.hostId === socket.id) {
      socket.emit('remove-track', { trackId })
    }
  }, [socket, room])

  const play = useCallback(() => {
    if (socket && room?.hostId === socket.id && audioRef.current) {
      audioRef.current.play().catch(() => {})
      socket.emit('play', { currentTime: audioRef.current.currentTime })
    }
  }, [socket, room])

  const pause = useCallback(() => {
    if (socket && room?.hostId === socket.id && audioRef.current) {
      audioRef.current.pause()
      socket.emit('pause', { currentTime: audioRef.current.currentTime })
    }
  }, [socket, room])

  const seek = useCallback((time: number) => {
    if (socket && room?.hostId === socket.id && audioRef.current) {
      audioRef.current.currentTime = time
      socket.emit('seek', { time })
    }
  }, [socket, room])

  const nextTrack = useCallback(() => {
    if (socket && room?.hostId === socket.id) {
      socket.emit('next-track')
    }
  }, [socket, room])

  const previousTrack = useCallback(() => {
    if (socket && room?.hostId === socket.id) {
      socket.emit('previous-track')
    }
  }, [socket, room])

  const sendChatMessage = useCallback((content: string) => {
    if (socket && content.trim()) {
      socket.emit('chat-message', { content: content.trim() })
    }
  }, [socket])

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
  }
}
