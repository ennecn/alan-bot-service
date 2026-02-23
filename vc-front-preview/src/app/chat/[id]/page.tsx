'use client';

import { useState, useRef, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Mic, Zap, Gift } from 'lucide-react';
import { creatures, mockMessages, autoReplies, gifts, type Message } from '@/data/mock';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';
import LowEnergyModal from '@/components/modals/LowEnergyModal';

export default function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const creature = creatures.find((c) => c.id === id);
  const { energy, consumeEnergy, hasEnoughEnergy, sendGift, language } = useStore();
  const t = getTranslation(language);
  const [messages, setMessages] = useState<Message[]>(mockMessages[id] || []);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showLowEnergyModal, setShowLowEnergyModal] = useState(false);
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isTyping]);

  if (!creature) return null;

  const handleSend = () => {
    if (!input.trim()) return;
    if (!hasEnoughEnergy(1)) {
      setShowLowEnergyModal(true);
      return;
    }
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    consumeEnergy(1);

    setIsTyping(true);
    const delay = 1000 + Math.random() * 1500;
    setTimeout(() => {
      setIsTyping(false);
      const replies = autoReplies[id] || ['...'];
      const reply: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: replies[Math.floor(Math.random() * replies.length)],
        emotion: creature.emotion.primary,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, reply]);
    }, delay);
  };

  const handleSendGift = (giftId: string) => {
    const gift = gifts.find((g) => g.id === giftId);
    if (!gift) return;
    const success = sendGift(gift.cost, gift.affection);
    if (!success) {
      setShowLowEnergyModal(true);
      return;
    }
    const giftMsg: Message = {
      id: `g-${Date.now()}`,
      role: 'user',
      content: `${language === 'zh' ? '送出了' : 'Sent'} ${gift.emoji} ${language === 'zh' ? gift.name : gift.nameEn}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, giftMsg]);
    setShowGiftPanel(false);
  };

  return (
    <div className="flex flex-col h-full md:max-w-2xl md:mx-auto md:border-x md:border-[#1a1a1a]">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-14 shrink-0 bg-[rgba(10,10,10,0.9)] backdrop-blur-xl border-b border-[#1a1a1a]">
        <button
          onClick={() => router.back()}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-[#141414] transition-colors duration-200 cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-[#8a8578]" />
        </button>
        <div
          className="w-9 h-9 rounded-full shrink-0 border border-[#222]"
          style={{
            backgroundImage: `url(${creature.photos[0]})`,
            backgroundSize: 'cover',
          }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#f0ece4] text-sm">{creature.name}</p>
          <p className="text-xs text-[#5a5650]">{creature.emotion.primary}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-[#8a8578] bg-[#141414] px-2.5 py-1 rounded-full">
          <Zap className="w-3.5 h-3.5 text-[#c9a84c]" />
          <span>{energy}</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-3 relative">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${creature.photos[0]})` }} />
        <div className="absolute inset-0 bg-[#0a0a0a]/90 backdrop-blur-sm" />
        <div className="relative z-10 space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#c9a84c] text-[#0a0a0a] rounded-2xl rounded-br-[4px]'
                      : 'bg-[#141414] border border-[#222] text-[#c8c0b4] rounded-2xl rounded-bl-[4px]'
                  }`}
                >
                  {msg.content}
                  {msg.emotion && msg.role === 'assistant' && (
                    <span className="block text-xs mt-1 text-[#5a5650]">{msg.emotion}</span>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isTyping && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="bg-[#141414] border border-[#222] rounded-2xl rounded-bl-[4px] px-4 py-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-2 h-2 rounded-full bg-[#5a5650]"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Gift Panel */}
      <AnimatePresence>
        {showGiftPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-[#0a0a0a] border-t border-[#1a1a1a]"
          >
            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2">
                {gifts.map((gift) => (
                  <button
                    key={gift.id}
                    onClick={() => handleSendGift(gift.id)}
                    className="flex flex-col items-center gap-1 p-3 rounded-[16px] bg-[#141414] border border-[#222] hover:border-[#c9a84c] transition-colors"
                  >
                    <span className="text-2xl">{gift.emoji}</span>
                    <span className="text-xs font-medium text-[#c8c0b4]">
                      {language === 'zh' ? gift.name : gift.nameEn}
                    </span>
                    <span className="text-xs text-[#c9a84c] font-semibold">{gift.cost}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 bg-[#0a0a0a] border-t border-[#1a1a1a]">
        {energy <= 0 ? (
          <div className="text-center text-sm text-[#5a5650] py-2">
            {language === 'zh' ? '能量不足，请稍后再来~' : 'Not enough energy, come back later~'}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGiftPanel(!showGiftPanel)}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors duration-200 cursor-pointer ${
                showGiftPanel ? 'bg-[#c9a84c] text-[#0a0a0a]' : 'text-[#5a5650] hover:text-[#c9a84c]'
              }`}
              aria-label={t.sendGift}
            >
              <Gift className="w-5 h-5" />
            </button>
            <button
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-[#5a5650] hover:text-[#c9a84c] transition-colors duration-200 cursor-pointer"
              aria-label="Voice"
            >
              <Mic className="w-5 h-5" />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={language === 'zh' ? '说点什么...' : 'Say something...'}
              className="flex-1 h-11 px-4 rounded-full bg-[#141414] border border-[#222] text-sm text-[#f0ece4] placeholder-[#5a5650] focus:outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/10 transition-all duration-200"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-[#c9a84c] text-[#0a0a0a] disabled:opacity-40 hover:bg-[#b8973f] transition-all duration-200 cursor-pointer disabled:cursor-default"
              aria-label={t.send}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>

      <LowEnergyModal
        isOpen={showLowEnergyModal}
        onClose={() => setShowLowEnergyModal(false)}
        required={1}
      />
    </div>
  );
}
