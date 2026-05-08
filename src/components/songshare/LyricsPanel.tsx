'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, X, Save, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSongShareStore } from '@/store/songshare'

interface LyricsPanelProps {
  onUpdateLyrics: (trackId: string, lyrics: string) => void
}

export function LyricsPanel({ onUpdateLyrics }: LyricsPanelProps) {
  const { room, socket, showLyrics, setShowLyrics } = useSongShareStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const isHost = room?.hostId === socket?.id
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  const lyrics = currentTrack?.lyrics || ''

  const handleStartEdit = () => {
    setDraft(lyrics)
    setEditing(true)
  }

  const handleSave = () => {
    if (currentTrack && isHost) {
      onUpdateLyrics(currentTrack.id, draft)
    }
    setEditing(false)
  }

  const handleCancel = () => {
    setDraft(lyrics)
    setEditing(false)
  }

  return (
    <>
      {/* Toggle button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowLyrics(!showLyrics)}
        className="relative text-zinc-400 hover:text-white h-9 w-9 rounded-full"
        title="Letra da música"
      >
        <FileText className="w-4 h-4" />
        {showLyrics && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-rose-500 rounded-full" />
        )}
      </Button>

      {/* Lyrics panel */}
      <AnimatePresence>
        {showLyrics && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-full right-0 mb-2 w-80 sm:w-96 h-[28rem] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-rose-500" />
                <h3 className="text-sm font-semibold text-zinc-200">Letra</h3>
                {currentTrack && (
                  <span className="text-xs text-zinc-500 truncate max-w-[140px]">
                    — {currentTrack.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {isHost && currentTrack && !editing && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleStartEdit}
                    className="h-7 w-7 text-zinc-500 hover:text-white rounded-md"
                    title="Editar letra"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowLyrics(false)}
                  className="h-7 w-7 text-zinc-500 hover:text-white rounded-md"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {editing ? (
                /* Editing mode */
                <div className="flex flex-col h-full p-3">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Cole ou digite a letra da música aqui..."
                    className="flex-1 bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-600 text-sm resize-none rounded-lg focus:border-rose-500/50 min-h-0"
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="ghost"
                      onClick={handleCancel}
                      className="flex-1 h-9 text-zinc-400 hover:text-white rounded-lg text-sm"
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleSave}
                      className="flex-1 h-9 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm"
                    >
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <ScrollArea className="h-full">
                  <div className="p-4">
                    {!currentTrack ? (
                      <div className="flex flex-col items-center justify-center h-full text-center py-12">
                        <div className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center mb-3">
                          <FileText className="w-5 h-5 text-zinc-600" />
                        </div>
                        <p className="text-sm text-zinc-500">
                          Nenhuma música selecionada
                        </p>
                      </div>
                    ) : lyrics ? (
                      <div className="whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed">
                        {lyrics}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center py-12">
                        <div className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center mb-3">
                          <FileText className="w-5 h-5 text-zinc-600" />
                        </div>
                        <p className="text-sm text-zinc-500">
                          Nenhuma letra disponível
                        </p>
                        {isHost && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleStartEdit}
                            className="mt-3 border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg text-xs"
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1.5" />
                            Adicionar letra
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
