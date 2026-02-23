'use client';

import { motion } from 'framer-motion';
import { X, Heart, Star, MessageCircle, Sparkles, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Creature } from '@/data/mock';

interface CreatureDetailProps {
  creature: Creature;
  onClose: () => void;
  onAddFriend: () => void;
  inline?: boolean;
}

export default function CreatureDetail({
  creature,
  onClose,
  onAddFriend,
  inline,
}: CreatureDetailProps) {
  if (inline) {
    return (
      <div className="bg-[#0a0a0a] h-full border-l border-[#1a1a1a]">
        <div className="flex items-center justify-between px-5 h-14 border-b border-[#1a1a1a]">
          <h3 className="font-semibold text-[#f0ece4]">Details</h3>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-[#1a1a1a] transition-colors duration-200 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-[#5a5650]" />
          </button>
        </div>
        <div className="px-5 py-4">
          <DetailContent creature={creature} onAddFriend={onAddFriend} />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="relative w-full max-h-[85%] bg-[#0a0a0a] rounded-t-3xl overflow-y-auto no-scrollbar"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      >
        <div className="sticky top-0 z-10 flex justify-center pt-3 pb-2 bg-[#0a0a0a]">
          <div className="w-10 h-1 rounded-full bg-[#333]" />
        </div>
        <button
          onClick={onClose}
          className="absolute top-3 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-[#1a1a1a] transition-colors duration-200 cursor-pointer z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-[#5a5650]" />
        </button>
        <div className="px-5 pb-8">
          <DetailContent creature={creature} onAddFriend={onAddFriend} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailContent({ creature, onAddFriend }: { creature: Creature; onAddFriend: () => void }) {
  return (
    <>
      {/* Photo gallery */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-4 -mx-5 px-5">
        {creature.photos.map((photo, i) => (
          <div
            key={i}
            className="shrink-0 w-48 h-64 rounded-2xl overflow-hidden bg-[#141414] border border-[#1a1a1a]"
            style={{
              backgroundImage: `url(${photo})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        ))}
      </div>

      {/* Name & stats */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-2xl font-bold font-[family-name:var(--font-display)] text-[#f0ece4]">
            {creature.name}
            <span className="text-lg font-normal text-[#5a5650] ml-2">{creature.age}</span>
          </h2>
          <div className="flex items-center gap-3 mt-1 text-sm text-[#8a8578]">
            <span className="flex items-center gap-1">
              <Star className="w-4 h-4 text-[#c9a84c] fill-[#c9a84c]" />
              {creature.rating}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" />
              {(creature.chatCount / 1000).toFixed(1)}k chats
            </span>
          </div>
        </div>
        <Badge className="bg-[#141414] text-[#c9a84c] border-[#222]">
          {creature.personality.mbti}
        </Badge>
      </div>

      {/* Profession with description */}
      {creature.profession && (
        <div className="mb-4 flex items-start gap-2">
          <Briefcase className="w-4 h-4 text-[#c9a84c] mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-[#f0ece4]">{creature.profession}</span>
            {creature.professionDescription && (
              <p className="text-xs text-[#8a8578] mt-0.5">{creature.professionDescription}</p>
            )}
          </div>
        </div>
      )}

      {/* Tags */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {creature.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="bg-[#141414] text-[#8a8578] border-[#222]">
            {tag}
          </Badge>
        ))}
      </div>

      {/* Bio */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-[#5a5650] mb-1.5">Bio</h3>
        <p className="text-[#c8c0b4] leading-relaxed">{creature.bio}</p>
      </div>

      {/* World */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-[#5a5650] mb-1.5">World</h3>
        <div className="bg-[#141414] rounded-2xl p-4 border border-[#1a1a1a]">
          <div className="flex items-start gap-2">
            <Sparkles className="w-5 h-5 text-[#c9a84c] shrink-0 mt-0.5" />
            <p className="text-[#c8c0b4] leading-relaxed">{creature.world}</p>
          </div>
        </div>
      </div>

      {/* Emotion */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-[#5a5650] mb-1.5">Mood</h3>
        <div className="flex items-center gap-3">
          <span className="text-[#c8c0b4]">{creature.emotion.primary}</span>
          <div className="flex-1 h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#c9a84c] rounded-full transition-all duration-300"
              style={{ width: `${creature.emotion.intensity * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Add friend button */}
      <button
        onClick={onAddFriend}
        className="w-full py-3.5 rounded-2xl bg-[#c9a84c] text-[#0a0a0a] font-semibold text-base shadow-lg hover:shadow-[0_0_20px_rgba(201,168,76,0.3)] transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
      >
        <Heart className="w-5 h-5" />
        Add Friend
      </button>
    </>
  );
}
