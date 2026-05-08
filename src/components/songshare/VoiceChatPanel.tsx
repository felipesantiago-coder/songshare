'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useSongShareStore } from '@/store/songshare'

interface VoiceChatPanelProps {
  onToggleMic: () => void
  onToggleMute: () => void
  onSetPeerVolume: (peerId: string, volume: number) => void
}

export function VoiceChatPanel({ onToggleMic, onToggleMute, onSetPeerVolume }: VoiceChatPanelProps) {
  const {
    room,
    socket,
    showVoicePanel,
    setShowVoicePanel,
    isMicActive,
    isMicMuted,
    voiceStreams,
  } = useSongShareStore()

  const users = room?.users ?? []
  const myUserId = socket?.id

  return (
    <div className="relative">
      {/* Toggle button - Mic icon in header */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowVoicePanel(!showVoicePanel)}
        className={`relative h-9 w-9 rounded-full transition-all duration-200 ${
          isMicActive
            ? isMicMuted
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-emerald-400 hover:text-emerald-300'
            : 'text-zinc-400 hover:text-white'
        }`}
        title="Chat de voz"
      >
        {isMicActive && !isMicMuted ? (
          <Mic className="w-4 h-4" />
        ) : (
          <MicOff className="w-4 h-4" />
        )}
        {isMicActive && (
          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
            isMicMuted ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
          }`} />
        )}
        {showVoicePanel && !isMicActive && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-rose-500 rounded-full" />
        )}
      </Button>

      {/* Voice Chat Panel - bottom sheet on mobile, dropdown on desktop */}
      <AnimatePresence>
        {showVoicePanel && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:bottom-auto sm:w-96 bg-zinc-900 border border-zinc-800 border-b-0 sm:border-b rounded-none sm:rounded-xl rounded-t-2xl sm:rounded-t-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-rose-500" />
                <h3 className="text-sm font-semibold text-zinc-200">Chat de Voz</h3>
                <span className="text-xs text-zinc-500">
                  ({users.length} {users.length === 1 ? 'pessoa' : 'pessoas'})
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowVoicePanel(false)}
                className="h-7 w-7 text-zinc-500 hover:text-white rounded-md"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Users list */}
            <ScrollArea className="flex-1 max-h-72">
              <div className="p-3 space-y-2">
                {users.map((user) => {
                  const isMe = user.id === myUserId
                  const streamKey = user.peerId
                  const voiceInfo = streamKey ? voiceStreams.get(streamKey) : null
                  const isSpeaking = isMe ? (isMicActive && !isMicMuted) : (voiceInfo?.isSpeaking ?? false)
                  const hasVoice = isMe ? isMicActive : !!voiceInfo
                  const peerVolume = voiceInfo?.volume ?? 1.0

                  return (
                    <motion.div
                      key={user.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-300 ${
                        hasVoice
                          ? isSpeaking
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : 'bg-zinc-800/40 border-zinc-700/30'
                          : 'bg-zinc-800/20 border-zinc-800/50'
                      }`}
                    >
                      {/* Avatar with speaking indicator */}
                      <div className="relative flex-shrink-0">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={`text-xs font-medium transition-colors duration-300 ${
                            isSpeaking
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : hasVoice
                                ? 'bg-zinc-700 text-zinc-300'
                                : 'bg-zinc-800 text-zinc-500'
                          }`}>
                            {user.username.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        {isSpeaking && (
                          <motion.div
                            className="absolute -inset-0.5 rounded-full border-2 border-emerald-400/50"
                            animate={{ opacity: [1, 0.4, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          />
                        )}
                      </div>

                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm truncate ${isSpeaking ? 'text-emerald-200' : 'text-zinc-300'}`}>
                            {user.username}
                          </span>
                          {isMe && (
                            <span className="text-[10px] text-zinc-600 flex-shrink-0">(voce)</span>
                          )}
                          {isSpeaking && !isMe && (
                            <motion.span
                              className="text-[10px] text-emerald-400 flex-shrink-0"
                              animate={{ opacity: [1, 0.6, 1] }}
                              transition={{ duration: 0.8, repeat: Infinity }}
                            >
                              falando
                            </motion.span>
                          )}
                        </div>

                        {/* Volume slider for other users with voice */}
                        {!isMe && hasVoice && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <Volume2 className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                            <Slider
                              value={[peerVolume]}
                              max={1}
                              min={0}
                              step={0.05}
                              onValueChange={(v) => {
                                if (streamKey) onSetPeerVolume(streamKey, v[0])
                              }}
                              className="flex-1 h-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:bg-white [&_[role=slider]]:border-0 [&_[data-orientation=horizontal]>.bg-primary]:bg-emerald-500"
                            />
                            <span className="text-[10px] text-zinc-600 w-6 text-right flex-shrink-0">
                              {Math.round(peerVolume * 100)}%
                            </span>
                          </div>
                        )}

                        {/* No voice indicator for other users */}
                        {!isMe && !hasVoice && (
                          <p className="text-[10px] text-zinc-600 mt-0.5">sem microfone</p>
                        )}

                        {/* Muted indicator for self */}
                        {isMe && isMicActive && isMicMuted && (
                          <p className="text-[10px] text-amber-500 mt-0.5">mutado</p>
                        )}
                      </div>

                      {/* Mic status icon */}
                      <div className="flex-shrink-0">
                        {isMe ? (
                          isMicActive ? (
                            isMicMuted ? (
                              <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center">
                                <MicOff className="w-3.5 h-3.5 text-amber-400" />
                              </div>
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                              </div>
                            )
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center">
                              <MicOff className="w-3.5 h-3.5 text-zinc-600" />
                            </div>
                          )
                        ) : (
                          voiceInfo ? (
                            <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
                              <Mic className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center">
                              <MicOff className="w-3.5 h-3.5 text-zinc-600" />
                            </div>
                          )
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </ScrollArea>

            {/* Bottom controls */}
            <div className="border-t border-zinc-800/50 p-3">
              <div className="flex items-center justify-center gap-3">
                {/* Mic toggle - main action */}
                <Button
                  onClick={onToggleMic}
                  className={`h-11 w-11 rounded-full transition-all duration-200 ${
                    isMicActive
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/50'
                  }`}
                  title={isMicActive ? 'Desativar microfone' : 'Ativar microfone'}
                >
                  {isMicActive ? (
                    <Mic className="w-5 h-5" />
                  ) : (
                    <MicOff className="w-5 h-5" />
                  )}
                </Button>

                {/* Mute toggle - secondary action (only when mic active) */}
                <AnimatePresence>
                  {isMicActive && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Button
                        onClick={onToggleMute}
                        className={`h-11 w-11 rounded-full transition-all duration-200 ${
                          isMicMuted
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/50'
                        }`}
                        title={isMicMuted ? 'Desmutar' : 'Mutar microfone'}
                      >
                        {isMicMuted ? (
                          <MicOff className="w-5 h-5" />
                        ) : (
                          <Volume2 className="w-5 h-5" />
                        )}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <p className="text-[10px] text-zinc-600 text-center mt-2">
                {isMicActive
                  ? isMicMuted
                    ? 'Microfone mutado — clique para desmutar'
                    : 'Microfone ativo — todos podem te ouvir'
                  : 'Clique no microfone para ativar a voz'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
