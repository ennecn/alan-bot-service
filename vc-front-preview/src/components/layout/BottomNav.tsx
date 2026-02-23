'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, MessageCircle, Wand2, UserCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';

export default function BottomNav() {
  const pathname = usePathname();
  const language = useStore((state) => state.language);
  const t = getTranslation(language);

  const tabs = [
    { href: '/discover', label: t.discover, icon: Sparkles },
    { href: '/chat', label: t.chat, icon: MessageCircle },
    { href: '/create', label: t.create, icon: Wand2 },
    { href: '/profile', label: t.profile, icon: UserCircle },
  ];

  // Hide nav on chat detail pages and auth pages
  if (pathname.match(/^\/chat\/.+/) || pathname === '/login' || pathname === '/register') return null;

  return (
    <nav className="shrink-0 bg-[rgba(10,10,10,0.9)] backdrop-blur-xl border-t border-[#222222] z-50 md:hidden">
      <div className="flex items-center justify-around h-16 px-4">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1.5 min-w-[60px] min-h-[60px] rounded-2xl transition-all duration-300 ease-out cursor-pointer group',
                active
                  ? 'scale-105'
                  : 'hover:scale-105'
              )}
            >
              <div className={cn(
                'relative transition-all duration-300 ease-out',
                active && 'animate-in zoom-in-50'
              )}>
                <Icon
                  className={cn(
                    'w-6 h-6 transition-all duration-300 ease-out',
                    active
                      ? 'text-[#c9a84c] scale-110'
                      : 'text-[#5a5650] group-hover:text-[#8a8578] group-hover:scale-105'
                  )}
                  strokeWidth={active ? 2.5 : 2}
                />
              </div>
              <span
                className={cn(
                  'text-[11px] font-semibold leading-none transition-all duration-300 ease-out',
                  active
                    ? 'text-[#c9a84c] scale-105'
                    : 'text-[#5a5650] group-hover:text-[#8a8578]'
                )}
              >
                {label}
              </span>
              {active && (
                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-1 bg-[#c9a84c] rounded-full animate-in slide-in-from-bottom-2" />
              )}
            </Link>
          );
        })}
      </div>
      {/* Safe area for iOS */}
      <div className="h-[env(safe-area-inset-bottom)] md:hidden" />
    </nav>
  );
}
