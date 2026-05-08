'use client'

import { motion } from 'framer-motion'
import { Headphones } from 'lucide-react'
import { useSongShareStore } from '@/store/songshare'
import { MusicPlayer } from './MusicPlayer'
import { Playlist } from './Playlist'
import { ChatPanel } from './ChatPanel'
import { LyricsPanel } from './LyricsPanel'
import { VoiceChatPanel } from './VoiceChatPanel'
import { UserList } from './UserList'

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
  const { room } = useSongShareStore()
  const isPlaying = room?.isPlaying ?? false
  const users = room?.users ?? []
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

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

        {/* Room info - mobile: show room name + users */}
        <div className="flex lg:hidden items-center gap-2">
          <div className="flex -space-x-1.5">
            {users.slice(0, 3).map((user) => (
              <div
                key={user.id}
                className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-900 flex items-center justify-center"
              >
                <span className="text-[7px] text-zinc-400 font-medium">
                  {user.username.substring(0, 2).toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          <span className="text-[11px] text-zinc-500">
            {users.length} online
          </span>
        </div>

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

            {/* Mobile layout: Player at top, Playlist below */}
            <div className="lg:hidden flex flex-col flex-1 overflow-hidden">
              {/* Mobile player section - the hero area */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex-shrink-0 px-5 pt-4 pb-3 bg-gradient-to-b from-zinc-950 to-zinc-900/50"
              >
                {/* Album art / Visual indicator */}
                <div className="flex justify-center mb-4">
                  <motion.div
                    animate={{
                      boxShadow: isPlaying
                        ? '0 0 40px rgba(244, 63, 94, 0.12), 0 0 80px rgba(244, 63, 94, 0.04)'
                        : '0 0 0px rgba(244, 63, 94, 0)',
                    }}
                    transition={{ duration: 1 }}
                    className="w-40 h-40 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/40 flex items-center justify-center"
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
                      <Headphones className="w-16 h-16 text-zinc-700" />
                    </motion.div>
                  </motion.div>
                </div>

                {/* Mobile player controls */}
                <MusicPlayer
                  audioRef={audioRef}
                  onPlay={onPlay}
                  onPause={onPause}
                  onSeek={onSeek}
                  onNext={onNext}
                  onPrevious={onPrevious}
                />
              </motion.div>

              {/* Visual divider */}
              <div className="flex-shrink-0 h-px bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />

              {/* Mobile playlist - scrollable below player */}
              <div className="flex-1 overflow-hidden">
                <Playlist
                  onAddTrack={onAddTrack}
                  onRemoveTrack={onRemoveTrack}
                  isDragOver={isDragOver}
                  setIsDragOver={setIsDragOver}
                />
              </div>

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
