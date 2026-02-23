'use client';

import { useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { Heart, X, Star, MapPin, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Creature } from '@/data/mock';
import { getTranslation } from '@/lib/i18n';

interface SwipeCardProps {
  creature: Creature;
  onSwipe: (dir: 'left' | 'right') => void;
  onTap: () => void;
  onMorePhotos?: () => void;
  lang?: 'zh' | 'en';
}

export default function SwipeCard({ creature, onSwipe, onTap, lang = 'zh' }: SwipeCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const likeOpacity = useTransform(x, [0, 100], [0, 1]);
  const nopeOpacity = useTransform(x, [-100, 0], [1, 0]);
  const t = getTranslation(lang);
  const [photoIndex, setPhotoIndex] = useState(0);

  const speciesMap: Record<string, string> = {
    human: t.human, beast: t.beast, immortal: t.immortal, demon: t.demon,
    elf: t.elf, dragon: t.dragon, vampire: t.vampire, angel: t.angel,
    robot: t.robot, hybrid: t.hybrid, other: t.other,
  };

  return (
    <motion.div
      className="absolute inset-0 cursor-pointer"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_, info) => {
        if (info.offset.x > 120) onSwipe('right');
        else if (info.offset.x < -120) onSwipe('left');
      }}
      onClick={(e) => {
        if (Math.abs(x.get()) < 5) onTap();
      }}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ x: 300, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <div className="relative w-full h-full rounded-[24px] overflow-hidden shadow-2xl shadow-black/40">
        {/* Photo */}
        <div
          className="absolute inset-0 bg-neutral-900"
          style={{
            backgroundImage: `url(${creature.photos[photoIndex]})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Photo dot indicators */}
        {creature.photos.length > 1 && (
          <div className="absolute top-4 left-0 right-0 flex justify-center gap-1.5">
            {creature.photos.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                className={`h-1 rounded-full transition-all ${
                  i === photoIndex ? 'w-6 bg-[#c9a84c]' : 'w-1.5 bg-white/30'
                }`}
              />
            ))}
          </div>
        )}

        {/* Like indicator */}
        <motion.div
          className="absolute top-8 left-6 border-4 border-[#c9a84c] rounded-xl px-4 py-2 -rotate-12"
          style={{ opacity: likeOpacity }}
        >
          <span className="text-[#c9a84c] text-2xl font-bold">LIKE</span>
        </motion.div>

        {/* Nope indicator */}
        <motion.div
          className="absolute top-8 right-6 border-4 border-[#8b4444] rounded-xl px-4 py-2 rotate-12"
          style={{ opacity: nopeOpacity }}
        >
          <span className="text-[#8b4444] text-2xl font-bold">NOPE</span>
        </motion.div>

        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 p-5 pb-6">
          <div className="flex items-end justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-2xl font-bold text-white font-[family-name:var(--font-display)]">{creature.name}</h2>
                <span className="text-lg text-white/60">{creature.age}</span>
              </div>
              <div className="flex items-center gap-1 text-white/50 text-sm mb-2">
                <MapPin className="w-3.5 h-3.5" />
                <span>{creature.world.split('—')[0].trim()}</span>
              </div>
              {creature.profession && (
                <div className="flex items-center gap-1 mb-2 bg-white/10 backdrop-blur-sm rounded-full px-2.5 py-1 w-fit">
                  <Briefcase className="w-3.5 h-3.5 text-white/70" />
                  <span className="text-white/80 text-xs">{creature.profession}</span>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap">
                {creature.species && (
                  <Badge variant="secondary" className="bg-[#c9a84c]/20 text-[#e8d5a3] border-0 backdrop-blur-sm text-xs">
                    {speciesMap[creature.species]}
                  </Badge>
                )}
                {creature.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="bg-white/10 text-white/80 border-0 backdrop-blur-sm text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">
              <Star className="w-4 h-4 text-[#c9a84c] fill-[#c9a84c]" />
              <span className="text-[#e8d5a3] text-sm font-medium">{creature.rating}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="absolute -bottom-2 left-0 right-0 flex justify-center gap-6 pb-2">
        <button
          onClick={(e) => { e.stopPropagation(); onSwipe('left'); }}
          className="w-14 h-14 rounded-full bg-[#141414] border border-white/10 shadow-lg shadow-black/30 flex items-center justify-center hover:scale-105 transition-transform duration-200 cursor-pointer"
          aria-label={t.pass}
        >
          <X className="w-7 h-7 text-white/50" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSwipe('right'); }}
          className="w-14 h-14 rounded-full bg-[#c9a84c] shadow-lg shadow-[#c9a84c]/30 flex items-center justify-center hover:scale-105 transition-transform duration-200 cursor-pointer"
          aria-label={t.like}
        >
          <Heart className="w-7 h-7 text-[#1a1a1a] fill-[#1a1a1a]" />
        </button>
      </div>
    </motion.div>
  );
}
