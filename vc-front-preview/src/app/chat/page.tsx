'use client';

import Link from 'next/link';
import { creatures, mockMessages } from '@/data/mock';
import { useStore } from '@/store/useStore';
import { ChevronRight, Users } from 'lucide-react';
import { getTranslation } from '@/lib/i18n';

export default function ChatPage() {
  const { friends, language } = useStore();
  const t = getTranslation(language);
  const friendCreatures = creatures.filter((c) => friends.includes(c.id));

  return (
    <div className="min-h-full">
      <div className="px-5 pt-[env(safe-area-inset-top)] h-14 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[#f0ece4] font-[family-name:var(--font-display)]">{t.chat}</h1>
        <Link
          href="/friends"
          className="flex items-center justify-center w-10 h-10 rounded-full bg-[#c9a84c] hover:bg-[#b8973f] transition-all duration-200 shadow-[0_0_12px_rgba(201,168,76,0.3)] hover:shadow-[0_0_20px_rgba(201,168,76,0.5)]"
        >
          <Users className="w-5 h-5 text-[#0a0a0a]" />
        </Link>
      </div>

      {friendCreatures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[#5a5650]">
          <p className="text-sm">{t.noFriendsYet}</p>
        </div>
      ) : (
        <div className="px-3 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-2 md:px-5">
          {friendCreatures.map((creature) => {
            const msgs = mockMessages[creature.id];
            const lastMsg = msgs?.[msgs.length - 1];
            return (
              <Link
                key={creature.id}
                href={`/chat/${creature.id}`}
                className="flex items-center gap-3 px-3 py-3 rounded-[20px] hover:bg-[#141414] transition-all duration-200 cursor-pointer"
              >
                <div
                  className="w-12 h-12 rounded-full shrink-0 border border-[#222] hover:border-[#c9a84c]/50 transition-colors duration-200"
                  style={{
                    backgroundImage: `url(${creature.photos[0]})`,
                    backgroundSize: 'cover',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#f0ece4]">{creature.name}</span>
                    <span className="text-xs text-[#5a5650]">
                      {lastMsg ? formatTime(lastMsg.timestamp, language) : ''}
                    </span>
                  </div>
                  <p className="text-sm text-[#8a8578] truncate mt-0.5">
                    {lastMsg?.content || t.startChatting}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-[#333] shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTime(ts: string, language: 'zh' | 'en') {
  const t = getTranslation(language);
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return t.justNow;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}${language === 'zh' ? t.minutesAgo : ` ${t.minutesAgo}`}`;
  if (diff < 86400000) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
