'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Headphones, LogOut, Copy, Check, ListMusic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSongShareStore } from '@/store/songshare'
import { MusicPlayer } from './MusicPlayer'
import { Playlist } from './Playlist'
import { ChatPanel } from './ChatPanel'
import { LyricsPanel } from './LyricsPanel'
import { VoiceChatPanel } from './VoiceChatPanel'
import { UserList } from './UserList'
import { SyncedLyricsView } from './SyncedLyricsView'
import { parseLrc, isLrcFormat } from '@/lib/lrc-parser'

interface RoomScreenProps {
  audioRef: React.RefObject<HTMLAudioElement | null>
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrevious: () => void
  onAddTrack: (file: File, lyrics?: string) => void
  onRemoveTrack: (trackId: string) => void
  onSendMessage: (content: string) => void
  onUpdateLyrics: (trackId: string, lyrics: string) => void
  onToggleMic: () => void
  onToggleMute: () => void
  onSetPeerVolume: (peerId: string, volume: number) => void
  onLeave: () => void
  isDragOver: boolean
  setIsDragOver: (over: boolean) => void
}

export function RoomScreen({
  audioRef,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrevious,
  onAddTrack,
  onRemoveTrack,
  onSendMessage,
  onUpdateLyrics,
  onToggleMic,
  onToggleMute,
  onSetPeerVolume,
  onLeave,
  isDragOver,
  setIsDragOver,
}: RoomScreenProps) {
  const { room, roomCode } = useSongShareStore()
  const isPlaying = room?.isPlaying ?? false
  const [copied, setCopied] = useState(false)
  const [showMobilePlaylist, setShowMobilePlaylist] = useState(false)

  // Track currentTime via rAF from audioRef
  const [currentTime, setCurrentTime] = useState(0)
  useEffect(() => {
    let active = true
    let last = 0
    const tick = () => {
      if (!active) return
      const now = performance.now()
      if (now - last >= 100) {
        last = now
        setCurrentTime(audioRef.current?.currentTime ?? 0)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => { active = false }
  }, [audioRef])

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = roomCode
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [roomCode])

  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  // Parse LRC lyrics when available
  const currentTrackLyrics = currentTrack?.lyrics ?? ''
  const parsedLrcLines = useMemo(() => {
    if (!currentTrackLyrics) return []
    if (!isLrcFormat(currentTrackLyrics)) return []
    return parseLrc(currentTrackLyrics)
  }, [currentTrackLyrics])

  return (
    <div className="h-dvh flex flex-col bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Single global audio element - avoids duplicate ref conflicts */}
      <audio ref={audioRef} preload="auto" className="hidden" />

      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
            <Headphones className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white hidden sm:inline">SongShare</span>
        </div>

        {/* Room code + users - mobile only */}
        <button
          onClick={copyCode}
          className="flex lg:hidden items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/40 active:scale-95 transition-transform"
          title="Toque para copiar o codigo"
        >
          <span className="text-sm font-mono font-bold tracking-[0.15em] text-white">
            {roomCode}
          </span>
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3 h-3 text-zinc-500" />
          )}
        </button>

        {/* Leave button - always visible */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onLeave}
          className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 h-9 w-9 rounded-full mr-1"
          title="Sair da sala"
        >
          <LogOut className="w-4 h-4" />
        </Button>

        {/* Chat, Voice & Lyrics toggles */}
        <div className="flex items-center gap-1">
          <VoiceChatPanel
            onToggleMic={onToggleMic}
            onToggleMute={onToggleMute}
            onSetPeerVolume={onSetPeerVolume}
          />
          <LyricsPanel onUpdateLyrics={onUpdateLyrics} />
          <ChatPanel onSendMessage={onSendMessage} />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Playlist panel - desktop side */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="hidden lg:flex flex-col w-80 xl:w-96 border-r border-zinc-800/50 relative"
          >
            <Playlist
              onAddTrack={onAddTrack}
              onRemoveTrack={onRemoveTrack}
              isDragOver={isDragOver}
              setIsDragOver={setIsDragOver}
            />
          </motion.div>

          {/* Center area - Player + Mobile playlist */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Now playing - Desktop large view */}
            <div className="hidden lg:flex flex-1 items-center justify-center p-8">
              <div className="w-full max-w-md">
                <div className="flex flex-col items-center mb-8">
                  <AnimatePresence mode="wait">
                    {parsedLrcLines.length > 0 ? (
                      <motion.div
                        key="lyrics-desktop"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                        className="w-full h-72 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-700/30 overflow-hidden relative"
                      >
                        <SyncedLyricsView
                          lines={parsedLrcLines}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                          className="h-full"
                        />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="art-desktop"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                      >
                        <motion.div
                          animate={{
                            boxShadow: isPlaying
                              ? '0 0 60px rgba(244, 63, 94, 0.15), 0 0 120px rgba(244, 63, 94, 0.05)'
                              : '0 0 0px rgba(244, 63, 94, 0)',
                          }}
                          transition={{ duration: 1 }}
                          className="w-56 h-56 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/50 flex items-center justify-center mb-6"
                        >
                          <motion.div
                            animate={{
                              rotate: isPlaying ? 360 : 0,
                            }}
                            transition={{
                              duration: 8,
                              repeat: Infinity,
                              ease: 'linear',
                            }}
                          >
                            <Headphones className="w-20 h-20 text-zinc-700" />
                          </motion.div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <MusicPlayer
                  audioRef={audioRef}
                  onPlay={onPlay}
                  onPause={onPause}
                  onSeek={onSeek}
                  onNext={onNext}
                  onPrevious={onPrevious}
                />
              </div>
            </div>

            {/* Mobile layout: Player takes full space, Playlist toggleable */}
            <div className="lg:hidden flex flex-col flex-1 overflow-hidden">
              {/* Mobile player section — art/lyrics fills all available space */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex-1 min-h-0 flex flex-col px-4 pt-3 bg-gradient-to-b from-zinc-950 to-zinc-900/50 overflow-hidden"
              >
                {/* Album art / Synced lyrics — flexible, fills available space */}
                <div className="flex-1 min-h-0 flex justify-center items-center">
                  <AnimatePresence mode="wait">
                    {parsedLrcLines.length > 0 ? (
                      <motion.div
                        key="lyrics-mobile"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                        className="w-full h-full rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-700/30 overflow-hidden"
                      >
                        <SyncedLyricsView
                          lines={parsedLrcLines}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                          className="h-full"
                        />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="art-mobile"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-center justify-center"
                      >
                        <motion.div
                          animate={{
                            boxShadow: isPlaying
                              ? '0 0 40px rgba(244, 63, 94, 0.12), 0 0 80px rgba(244, 63, 94, 0.04)'
                              : '0 0 0px rgba(244, 63, 94, 0)',
                          }}
                          transition={{ duration: 1 }}
                          className="w-44 h-44 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/40 flex items-center justify-center"
                        >
                          <motion.div
                            animate={{
                              rotate: isPlaying ? 360 : 0,
                            }}
                            transition={{
                              duration: 8,
                              repeat: Infinity,
                              ease: 'linear',
                            }}
                          >
                            <Headphones className="w-18 h-18 text-zinc-700" />
                          </motion.div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Mobile player controls — compact, at the bottom */}
                <div className="flex-shrink-0 pb-2">
                  <MusicPlayer
                    audioRef={audioRef}
                    onPlay={onPlay}
                    onPause={onPause}
                    onSeek={onSeek}
                    onNext={onNext}
                    onPrevious={onPrevious}
                  />
                </div>
              </motion.div>

              {/* Playlist toggle button — fixed above divider */}
              <div className="flex-shrink-0">
                <button
                  onClick={() => setShowMobilePlaylist(!showMobilePlaylist)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
                >
                  <ListMusic className="w-3.5 h-3.5" />
                  <span>{showMobilePlaylist ? 'Ocultar playlist' : 'Ver playlist'}</span>
                  {room?.playlist && room.playlist.length > 0 && (
                    <span className="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-full text-[10px]">
                      {room.playlist.length}
                    </span>
                  )}
                </button>

                {/* Visual divider */}
                <div className="h-px bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />
              </div>

              {/* Mobile playlist — collapsible */}
              <AnimatePresence>
                {showMobilePlaylist && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: '40dvh', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden flex-shrink-0"
                  >
                    <Playlist
                      onAddTrack={onAddTrack}
                      onRemoveTrack={onRemoveTrack}
                      isDragOver={isDragOver}
                      setIsDragOver={setIsDragOver}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Safe area bottom padding for notched phones */}
              <div className="flex-shrink-0 h-[env(safe-area-inset-bottom)]" />
            </div>
          </div>
        </div>

        {/* Right sidebar - Users (desktop only) */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="hidden lg:flex flex-col w-64 xl:w-72 border-l border-zinc-800/50 p-4"
        >
          <UserList onLeave={onLeave} />
        </motion.div>
      </div>
    </div>
  )
}
