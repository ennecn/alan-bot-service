'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Upload, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/models', label: 'Models', icon: Cpu },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-14 flex flex-col items-center py-4 gap-2 border-r border-[var(--border)] bg-[var(--bg)]">
      <div className="text-xs font-bold text-[var(--accent)] mb-4">A</div>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          title={label}
          className={cn(
            'w-10 h-10 flex items-center justify-center rounded-lg transition-colors',
            pathname.startsWith(href)
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]',
          )}
        >
          <Icon size={20} />
        </Link>
      ))}
    </aside>
  );
}
