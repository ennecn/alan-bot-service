'use client';



import { Zap, ChevronRight, Settings, Crown, Users, Heart, Palette, Gift, HelpCircle, UserPlus } from 'lucide-react';

import { useRouter } from 'next/navigation';

import { useStore } from '@/store/useStore';

import { getTranslation } from '@/lib/i18n';

import { creatures } from '@/data/mock';



export default function ProfilePage() {

  const router = useRouter();

  const { energy, maxEnergy, friends, language } = useStore();

  const t = getTranslation(language);

  const friendCreatures = creatures.filter((c) => friends.includes(c.id));

  const energyPercent = (energy / maxEnergy) * 100;



  return (

    <div className="min-h-full bg-[#f9f9f9]">

      <div className="px-5 pt-[env(safe-area-inset-top)] h-14 flex items-center justify-between">

        <h1 className="text-lg font-semibold text-gray-800">{t.myProfile}</h1>

        <button

          onClick={() => router.push('/settings')}

          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer"

          aria-label={t.settings}

        >

          <Settings className="w-5 h-5 text-gray-500" />

        </button>

      </div>



      <div className="px-5 pt-2 md:grid md:grid-cols-2 md:gap-6 md:max-w-4xl">

        {/* Left column */}

        <div>

          {/* User card — black */}

          <div className="bg-black rounded-[20px] p-5 text-white mb-4">

            <div className="flex items-center gap-4 mb-4">

              <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-2xl font-bold">

                VC

              </div>

              <div>

                <h2 className="text-xl font-bold">VibeCreature</h2>

                <p className="text-white/60 text-sm">{t.explorer}</p>

              </div>

            </div>

            <div className="flex gap-6 text-sm">

              <div className="text-center">

                <p className="font-bold text-lg">{friends.length}</p>

                <p className="text-white/60">{t.friends}</p>

              </div>

              <div className="text-center">

                <p className="font-bold text-lg">0</p>

                <p className="text-white/60">{t.creations}</p>

              </div>

              <div className="text-center">

                <p className="font-bold text-lg">128</p>

                <p className="text-white/60">{t.likes}</p>

              </div>

            </div>

          </div>



          {/* Energy bar — orange */}

          <div className="bg-white rounded-[20px] p-4 mb-4 border border-gray-100">

            <div className="flex items-center justify-between mb-2">

              <div className="flex items-center gap-2">

                <Zap className="w-5 h-5 text-[#fe4a22]" />

                <span className="font-medium text-gray-700">{t.energy}</span>

              </div>

              <span className="text-sm text-gray-500">{energy}/{maxEnergy}</span>

            </div>

            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">

              <div

                className="h-full bg-[#fe4a22] rounded-full transition-all duration-500"

                style={{ width: `${energyPercent}%` }}

              />

            </div>

            <p className="text-xs text-gray-400 mt-2">{t.energyInfo}</p>

          </div>



          {/* 2x2 Feature Grid */}

          <div className="grid grid-cols-2 gap-3 mb-4">

            <button

              onClick={() => router.push('/payment?tab=recharge')}

              className="bg-[#fe4a22] rounded-[20px] p-4 text-left transition-transform active:scale-[0.98]"

            >

              <Zap className="w-6 h-6 text-white mb-2" />

              <p className="font-semibold text-white text-sm">{t.rechargeEnergy}</p>

            </button>

            <button

              onClick={() => router.push('/payment?tab=subscription')}

              className="bg-black rounded-[20px] p-4 text-left transition-transform active:scale-[0.98]"

            >

              <Crown className="w-6 h-6 text-white mb-2" />

              <p className="font-semibold text-white text-sm">{t.upgradeMember}</p>

            </button>

            <button

              onClick={() => router.push('/payment?tab=earn')}

              className="bg-white border border-gray-200 rounded-[20px] p-4 text-left transition-transform active:scale-[0.98]"

            >

              <Gift className="w-6 h-6 text-gray-700 mb-2" />

              <p className="font-semibold text-gray-700 text-sm">{t.earnEnergy}</p>

            </button>

            <button

              onClick={() => router.push('/create')}

              className="bg-white border border-gray-200 rounded-[20px] p-4 text-left transition-transform active:scale-[0.98]"

            >

              <Palette className="w-6 h-6 text-gray-700 mb-2" />

              <p className="font-semibold text-gray-700 text-sm">{t.myCreations}</p>

            </button>

          </div>

        </div>



        {/* Right column */}

        <div>

          {/* Friends */}

          <div className="bg-white rounded-[20px] p-4 border border-gray-100">

            <div className="flex items-center gap-2 mb-3">

              <Users className="w-5 h-5 text-gray-500" />

              <span className="font-medium text-gray-700">{t.myFriends}</span>

            </div>

            {friendCreatures.length === 0 ? (

              <p className="text-sm text-gray-400 py-2">{t.noFriends}</p>

            ) : (

              <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1">

                {friendCreatures.map((c) => (

                  <div key={c.id} className="flex flex-col items-center gap-1.5 shrink-0">

                    <div

                      className="w-14 h-14 rounded-full bg-gray-200"

                      style={{

                        backgroundImage: `url(${c.photos[0]})`,

                        backgroundSize: 'cover',

                      }}

                    />

                    <span className="text-xs text-gray-600">{c.name}</span>

                  </div>

                ))}

              </div>

            )}

          </div>



          {/* Secondary menu */}

          <div className="mt-4 space-y-1 pb-4">

            {[

              { icon: Heart, label: t.myFavorites },

              { icon: UserPlus, label: t.inviteFriends },

              { icon: HelpCircle, label: t.help },

              { icon: Settings, label: t.accountSettings },

            ].map(({ icon: Icon, label }) => (

              <button

                key={label}

                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-100 transition-colors duration-200 cursor-pointer"

              >

                <Icon className="w-5 h-5 text-gray-400" />

                <span className="flex-1 text-left text-sm text-gray-700">{label}</span>

                <ChevronRight className="w-4 h-4 text-gray-300" />

              </button>

            ))}

          </div>

        </div>

      </div>

    </div>

  );

}

