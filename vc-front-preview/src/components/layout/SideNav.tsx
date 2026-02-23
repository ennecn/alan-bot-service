'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, MessageCircle, Wand2, UserCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';

export default function SideNav() {
  const pathname = usePathname();
  const language = useStore((state) => state.language);
  const t = getTranslation(language);

  const tabs = [
    { href: '/discover', label: t.discover, icon: Sparkles },
    { href: '/chat', label: t.chat, icon: MessageCircle },
    { href: '/create', label: t.create, icon: Wand2 },
    { href: '/profile', label: t.profile, icon: UserCircle },
  ];

  // Hide on auth pages
  if (pathname === '/login' || pathname === '/register') return null;

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 h-full bg-[#0a0a0a] border-r border-[#1a1a1a]">
      {/* Logo */}
      <div className="px-5 h-16 flex items-center">
        <h1 className="text-xl tracking-tight">
          <span className="font-['Playfair_Display'] italic text-[#f0ece4]">Vibe</span>
          <span className="font-semibold text-[#c9a84c]">Creature</span>
        </h1>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-2 space-y-1.5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-3 px-4 py-3 rounded-[16px] transition-all duration-300 ease-out cursor-pointer group',
                active
                  ? 'bg-[#141414]'
                  : 'hover:bg-[#111111]'
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-all duration-300 ease-out',
                  active
                    ? 'text-[#f0ece4]'
                    : 'text-[#5a5650] group-hover:text-[#8a8578]'
                )}
                strokeWidth={active ? 2.5 : 2}
              />
              <span
                className={cn(
                  'text-sm font-semibold transition-all duration-300 ease-out',
                  active
                    ? 'text-[#f0ece4]'
                    : 'text-[#5a5650] group-hover:text-[#8a8578]'
                )}
              >
                {label}
              </span>
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#c9a84c] rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#1a1a1a]">
        <p className="text-xs text-[#5a5650]">{t.tagline || 'Meet your soul companion'}</p>
      </div>
    </aside>
  );
}
