'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, MessageCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSongShareStore } from '@/store/songshare'

interface ChatPanelProps {
  onSendMessage: (content: string) => void
}

export function ChatPanel({ onSendMessage }: ChatPanelProps) {
  const { room, showChat, setShowChat } = useSongShareStore()
  const [message, setMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const messages = room?.chatMessages || []

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  // Focus input when chat opens
  useEffect(() => {
    if (showChat && inputRef.current) {
      inputRef.current.focus()
    }
  }, [showChat])

  const handleSend = () => {
    if (message.trim()) {
      onSendMessage(message.trim())
      setMessage('')
    }
  }

  const closePanel = () => setShowChat(false)

  // Panel inner content — shared between mobile and desktop
  const panelInner = useMemo(() => (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-rose-500" />
          <h3 className="text-sm font-semibold text-zinc-200">Chat</h3>
          <span className="text-xs text-zinc-500">
            ({room?.users.length || 0} online)
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={closePanel}
          className="h-7 w-7 text-zinc-500 hover:text-white rounded-md"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-zinc-600">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="group">
              {msg.type === 'system' ? (
                <div className="text-center py-1">
                  <span className="text-xs text-zinc-600 italic">
                    {msg.content}
                  </span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-rose-400">
                        {msg.username}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 break-words mt-0.5">
                      {msg.content}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-zinc-800/50 flex-shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="flex gap-2"
        >
          <Input
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Mensagem..."
            className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 text-sm h-9 rounded-lg focus:border-rose-500/50"
            maxLength={500}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!message.trim()}
            className="h-9 w-9 bg-rose-500 hover:bg-rose-600 text-white rounded-lg flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </>
  ), [messages])

  return (
    <div className="relative">
      {/* Toggle button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowChat(!showChat)}
        className="relative text-zinc-400 hover:text-white h-9 w-9 rounded-full"
      >
        <MessageCircle className="w-4 h-4" />
        {showChat && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-rose-500 rounded-full" />
        )}
      </Button>

      {/* Desktop version — dropdown below toggle button */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            key="chat-desktop"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="hidden sm:block absolute top-full right-0 w-96 h-[24rem] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col z-50"
          >
            {panelInner}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile version — portal to body, bottom sheet with safe area */}
      {mounted && createPortal(
        <AnimatePresence>
          {showChat && (
            <>
              {/* Backdrop */}
              <motion.div
                key="chat-mobile-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm sm:hidden z-[55]"
                onClick={closePanel}
              />
              {/* Bottom sheet panel */}
              <motion.div
                key="chat-mobile-panel"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 40 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="fixed inset-x-0 bottom-0 sm:hidden flex flex-col bg-zinc-900 border border-zinc-800 border-b-0 rounded-t-2xl shadow-2xl shadow-black/40 overflow-hidden z-[60]"
                style={{
                  height: 'max(50dvh, calc(100dvh - 12rem))',
                  maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 4rem)',
                  paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)',
                }}
              >
                {/* Drag handle visual indicator */}
                <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                  <div className="w-10 h-1 rounded-full bg-zinc-700" />
                </div>
                {panelInner}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
