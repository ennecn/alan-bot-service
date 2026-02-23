'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter } from 'lucide-react';
import SwipeCard from '@/components/discover/SwipeCard';
import CreatureDetail from '@/components/discover/CreatureDetail';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';
import type { Species } from '@/data/mock';

export default function DiscoverPage() {
  const { discoveredCreatures, currentCreatureIndex, nextCreature, addFriend, language } =
    useStore();
  const [showDetail, setShowDetail] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [speciesFilter, setSpeciesFilter] = useState<'all' | Species>('all');
  const t = getTranslation(language);

  const filtered = useMemo(() => {
    return discoveredCreatures.filter((creature) => {
      const matchesGender = genderFilter === 'all' || creature.gender === genderFilter;
      const matchesSpecies = speciesFilter === 'all' || creature.species === speciesFilter;
      return matchesGender && matchesSpecies;
    });
  }, [discoveredCreatures, genderFilter, speciesFilter]);

  const current = filtered[currentCreatureIndex % filtered.length];

  const handleSwipe = (dir: 'left' | 'right') => {
    if (dir === 'right' && current) {
      addFriend(current.id);
    }
    nextCreature();
  };

  const allSpecies: { label: string; value: 'all' | Species }[] = [
    { label: t.all, value: 'all' },
    { label: t.human, value: 'human' },
    { label: t.beast, value: 'beast' },
    { label: t.immortal, value: 'immortal' },
    { label: t.demon, value: 'demon' },
    { label: t.elf, value: 'elf' },
    { label: t.dragon, value: 'dragon' },
    { label: t.vampire, value: 'vampire' },
    { label: t.angel, value: 'angel' },
    { label: t.robot, value: 'robot' },
    { label: t.hybrid, value: 'hybrid' },
    { label: t.other, value: 'other' },
  ];

  return (
    <div className="relative flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-[env(safe-area-inset-top)] h-14 shrink-0">
        <h1 className="text-lg font-semibold text-[#f0ece4] font-[family-name:var(--font-display)]">
          {t.discover}
        </h1>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-[#141414] transition-colors duration-200 cursor-pointer"
          aria-label={t.filters}
        >
          <Filter className="w-5 h-5 text-[#5a5650]" />
        </button>
      </div>

      {/* Filter bar */}
      <AnimatePresence>
        {showFilter && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden px-5"
          >
            <div className="flex flex-col gap-3 pb-3">
              {/* Gender filter */}
              <div>
                <div className="text-xs text-[#5a5650] mb-1.5">{t.gender}</div>
                <div className="flex gap-2">
                  {[
                    { label: t.all, value: 'all' as const },
                    { label: t.female, value: 'female' as const },
                    { label: t.male, value: 'male' as const },
                  ].map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setGenderFilter(value)}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 cursor-pointer ${
                        genderFilter === value
                          ? 'bg-[#c9a84c] text-[#0a0a0a]'
                          : 'bg-[#141414] text-[#8a8578] hover:bg-[#1a1a1a] border border-[#222]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Species filter — 11 types */}
              <div>
                <div className="text-xs text-[#5a5650] mb-1.5">{t.species}</div>
                <div className="flex gap-2 flex-wrap">
                  {allSpecies.map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setSpeciesFilter(value)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 cursor-pointer ${
                        speciesFilter === value
                          ? 'bg-[#c9a84c] text-[#0a0a0a]'
                          : 'bg-[#141414] text-[#8a8578] hover:bg-[#1a1a1a] border border-[#222]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop: side-by-side layout / Mobile: stacked */}
      <div className="flex-1 flex min-h-0">
        {/* Swipe area */}
        <div className="flex-1 relative px-4 pb-4 md:flex md:items-center md:justify-center">
          <div className="h-full md:h-[80%] md:w-[380px] md:max-h-[640px] relative">
            <AnimatePresence mode="popLayout">
              {current && (
                <SwipeCard
                  key={current.id + currentCreatureIndex}
                  creature={current}
                  onSwipe={handleSwipe}
                  onTap={() => setShowDetail(true)}
                  lang={language}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Desktop: detail panel */}
        <AnimatePresence>
          {showDetail && current && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="hidden md:block shrink-0 overflow-hidden border-l border-[#1a1a1a]"
            >
              <div className="w-[380px] h-full overflow-y-auto no-scrollbar">
                <CreatureDetail
                  creature={current}
                  onClose={() => setShowDetail(false)}
                  onAddFriend={() => {
                    addFriend(current.id);
                    setShowDetail(false);
                    nextCreature();
                  }}
                  inline
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile: detail as overlay */}
      <AnimatePresence>
        {showDetail && current && (
          <div className="md:hidden">
            <CreatureDetail
              creature={current}
              onClose={() => setShowDetail(false)}
              onAddFriend={() => {
                addFriend(current.id);
                setShowDetail(false);
                nextCreature();
              }}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
