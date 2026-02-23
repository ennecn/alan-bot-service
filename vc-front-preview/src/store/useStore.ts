import { create } from 'zustand';

import { persist } from 'zustand/middleware';

import { creatures, type Creature, type User } from '@/data/mock';

import type { Language } from '@/lib/i18n';



interface AppState {

  energy: number;

  maxEnergy: number;

  friends: string[];

  currentCreatureIndex: number;

  discoveredCreatures: Creature[];

  language: Language;

  user: User | null;

  subscription: string | null;



  addFriend: (id: string) => void;

  removeFriend: (id: string) => void;

  consumeEnergy: (amount: number) => void;

  addEnergy: (amount: number) => void;

  hasEnoughEnergy: (amount: number) => boolean;

  nextCreature: () => void;

  isFriend: (id: string) => boolean;

  setLanguage: (lang: Language) => void;

  login: (user: User) => void;

  logout: () => void;

  setSubscription: (tier: string | null) => void;

  sendGift: (cost: number, affection: number) => boolean;

}



export const useStore = create<AppState>()(

  persist(

    (set, get) => ({

      energy: 50,

      maxEnergy: 100,

      friends: ['luna-001', 'sophia-003'],

      currentCreatureIndex: 0,

      discoveredCreatures: [...creatures],

      language: 'en',

      user: null,

      subscription: null,



      addFriend: (id) =>

        set((s) => ({

          friends: s.friends.includes(id) ? s.friends : [...s.friends, id],

        })),



      removeFriend: (id) =>

        set((s) => ({ friends: s.friends.filter((f) => f !== id) })),



      consumeEnergy: (amount) =>

        set((s) => ({ energy: Math.max(0, s.energy - amount) })),



      addEnergy: (amount) =>

        set((s) => ({ energy: Math.min(s.maxEnergy, s.energy + amount) })),



      hasEnoughEnergy: (amount) => get().energy >= amount,



      nextCreature: () =>

        set((s) => ({

          currentCreatureIndex:

            (s.currentCreatureIndex + 1) % s.discoveredCreatures.length,

        })),



      isFriend: (id) => get().friends.includes(id),



      setLanguage: (lang) => set({ language: lang }),



      login: (user) => set({ user }),



      logout: () => set({ user: null, subscription: null }),



      setSubscription: (tier) => set({ subscription: tier }),



      sendGift: (cost, _affection) => {

        const state = get();

        if (state.energy < cost) return false;

        set({ energy: state.energy - cost });

        return true;

      },

    }),

    {

      name: 'vibecreature-storage',

    }

  )

);

