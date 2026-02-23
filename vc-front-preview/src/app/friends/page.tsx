'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Briefcase, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { creatures } from '@/data/mock';
import { getTranslation } from '@/lib/i18n';

export default function FriendsPage() {
  const router = useRouter();
  const { friends, language } = useStore();
  const t = getTranslation(language);
  const friendCreatures = creatures.filter((c) => friends.includes(c.id));

  const speciesMap: Record<string, string> = {
    human: t.human, beast: t.beast, immortal: t.immortal, demon: t.demon,
    elf: t.elf, dragon: t.dragon, vampire: t.vampire, angel: t.angel,
    robot: t.robot, hybrid: t.hybrid, other: t.other,
  };

  return (
    <div className="min-h-full bg-[#f9f9f9]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="px-5 pt-[env(safe-area-inset-top)] h-14 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">{t.friendsList}</h1>
          <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
            <span className="font-medium">{friendCreatures.length}</span>
            <span>{t.friends}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-6 max-w-4xl mx-auto">
        {friendCreatures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Sparkles className="w-12 h-12 text-gray-300" />
            </div>
            <p className="text-gray-400 text-center">
              {language === 'zh' ? '还没有好友，去发现页面添加吧' : 'No friends yet, go discover to add some'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {friendCreatures.map((creature, index) => (
              <motion.div
                key={creature.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-[20px] overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-gray-100"
                onClick={() => router.push(`/chat/${creature.id}`)}
              >
                {/* Photo */}
                <div className="relative h-64 overflow-hidden">
                  <div
                    className="absolute inset-0 bg-cover bg-center transform hover:scale-110 transition-transform duration-500"
                    style={{ backgroundImage: `url(${creature.photos[0]})` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                  {/* Species badge */}
                  <div className="absolute top-3 right-3">
                    <div className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-medium">
                      {speciesMap[creature.species] || creature.species}
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="text-white text-xl font-bold mb-1">
                      {creature.name}, {creature.age}
                    </h3>
                  </div>
                </div>

                {/* Info */}
                <div className="p-4 space-y-3">
                  <div className="flex items-start gap-2 text-gray-700">
                    <Briefcase className="w-4 h-4 text-[#fe4a22] shrink-0 mt-0.5" />
                    <div>
                      <span className="text-sm font-medium">{creature.profession}</span>
                      {creature.professionDescription && (
                        <p className="text-xs text-gray-500 mt-0.5">{creature.professionDescription}</p>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-2">
                    {creature.tags.slice(0, 3).map((tag, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-1">
                      <div className="flex">
                        {[...Array(5)].map((_, i) => (
                          <svg
                            key={i}
                            className={`w-3.5 h-3.5 ${i < Math.floor(creature.rating) ? 'text-yellow-400' : 'text-gray-200'}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        ))}
                      </div>
                      <span className="text-xs text-gray-500 ml-1">{creature.rating}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {creature.chatCount.toLocaleString()} {language === 'zh' ? '次对话' : 'chats'}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
