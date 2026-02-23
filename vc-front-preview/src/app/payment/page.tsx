'use client';

import { useState, useEffect, Suspense } from 'react';
import { ChevronLeft, Zap, Check, CreditCard, Smartphone, Gift, Users, Share2, Calendar, Trophy, Crown, Package } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';
import { subscriptions } from '@/data/mock';

const PAYMENT_PACKAGES = [
  { id: 'starter', energy: 500, price: 4.99, bonus: 0, popular: false },
  { id: 'basic', energy: 1000, price: 9.99, bonus: 0, popular: true },
  { id: 'standard', energy: 2200, price: 19.99, bonus: 10, popular: false },
  { id: 'premium', energy: 6000, price: 49.99, bonus: 20, popular: false },
  { id: 'ultimate', energy: 13000, price: 99.99, bonus: 30, popular: false },
];

const LOOT_BOXES = [
  { id: 'copper', nameZh: '铜箱', nameEn: 'Copper', cost: 50, minReward: 20, maxReward: 80, color: 'bg-amber-600' },
  { id: 'silver', nameZh: '银箱', nameEn: 'Silver', cost: 100, minReward: 60, maxReward: 200, color: 'bg-gray-400' },
  { id: 'gold', nameZh: '金箱', nameEn: 'Gold', cost: 200, minReward: 150, maxReward: 500, color: 'bg-yellow-500' },
];

type TabType = 'subscription' | 'recharge' | 'earn';

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-[#f9f9f9] flex items-center justify-center"><Zap className="w-8 h-8 text-gray-300 animate-pulse" /></div>}>
      <PaymentContent />
    </Suspense>
  );
}

function PaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, energy, addEnergy } = useStore();
  const t = getTranslation(language);
  const isZh = language === 'zh';

  const initialTab = (searchParams.get('tab') as TabType) || 'subscription';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [selectedPackage, setSelectedPackage] = useState('basic');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'web3'>('stripe');
  const [processing, setProcessing] = useState(false);

  // Task states
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  const [checkInStreak, setCheckInStreak] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('lastCheckIn');
    const streak = localStorage.getItem('checkInStreak');
    if (saved) setLastCheckIn(saved);
    if (streak) setCheckInStreak(parseInt(streak));
  }, []);

  const canCheckInToday = () => {
    if (!lastCheckIn) return true;
    return new Date().toDateString() !== new Date(lastCheckIn).toDateString();
  };

  const handleCheckIn = () => {
    if (!canCheckInToday()) return;
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const lastDate = lastCheckIn ? new Date(lastCheckIn).toDateString() : null;
    const newStreak = lastDate === yesterday ? checkInStreak + 1 : 1;
    setLastCheckIn(today);
    setCheckInStreak(newStreak);
    localStorage.setItem('lastCheckIn', today);
    localStorage.setItem('checkInStreak', newStreak.toString());
    addEnergy(50);
    alert(isZh ? `签到成功！+50 能量，连续 ${newStreak} 天` : `Check-in! +50 energy, ${newStreak} day streak`);
  };

  const handleOpenBox = (box: typeof LOOT_BOXES[0]) => {
    if (energy < box.cost) {
      alert(isZh ? '能量不足！' : 'Not enough energy!');
      return;
    }
    const reward = Math.floor(Math.random() * (box.maxReward - box.minReward + 1)) + box.minReward;
    addEnergy(reward - box.cost);
    alert(isZh ? `开箱成功！获得 ${reward} 能量！` : `Opened! Got ${reward} energy!`);
  };

  const handlePurchase = async () => {
    setProcessing(true);
    const pkg = PAYMENT_PACKAGES.find(p => p.id === selectedPackage);
    if (!pkg) return;
    await new Promise(resolve => setTimeout(resolve, 2000));
    addEnergy(pkg.energy + pkg.bonus);
    setProcessing(false);
    alert(t.paymentSuccess);
    router.push('/profile');
  };

  return (
    <div className="min-h-full bg-[#f9f9f9]">
      {/* Header */}
      <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 z-10">
        <div className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14">
          <button
            onClick={() => router.back()}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="w-6 h-6 text-gray-700" />
          </button>
          <h1 className="text-lg font-bold text-black">
            {isZh ? '能量中心' : 'Energy Center'}
          </h1>
        </div>

        {/* 3 Tabs */}
        <div className="flex px-5 gap-1">
          {[
            { id: 'subscription' as const, label: t.subscription },
            { id: 'recharge' as const, label: t.energyPacks },
            { id: 'earn' as const, label: t.earnEnergy },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? 'text-black border-b-2 border-black'
                  : 'text-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-6 space-y-6 pb-24">
        {/* Current Energy */}
        <div className="bg-black rounded-[20px] p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-sm mb-1">{t.currentEnergy}</p>
              <p className="text-4xl font-bold">{energy}</p>
            </div>
            <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
              <Zap className="w-8 h-8 text-[#fe4a22]" />
            </div>
          </div>
        </div>

        {/* Subscription Tab */}
        {activeTab === 'subscription' && (
          <div className="space-y-4">
            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className={`relative rounded-[20px] p-5 border-2 transition-all ${
                  sub.recommended
                    ? 'border-[#fe4a22] bg-white shadow-lg'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {sub.recommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#fe4a22] text-white text-xs px-4 py-1 rounded-full font-semibold">
                    {t.recommended}
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Crown className={`w-6 h-6 ${sub.recommended ? 'text-[#fe4a22]' : 'text-gray-400'}`} />
                    <div>
                      <h3 className="font-bold text-gray-800">{isZh ? sub.name : sub.nameEn}</h3>
                      <p className="text-2xl font-bold text-black">${sub.price}<span className="text-sm font-normal text-gray-500">{t.perMonth}</span></p>
                    </div>
                  </div>
                </div>
                <ul className="space-y-2">
                  {(isZh ? sub.features : sub.featuresEn).map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="w-4 h-4 text-[#fe4a22] shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button className={`w-full mt-4 py-3 rounded-[12px] font-semibold text-sm transition-colors ${
                  sub.recommended
                    ? 'bg-[#fe4a22] text-white hover:bg-[#e5421e]'
                    : 'bg-black text-white hover:bg-gray-900'
                }`}>
                  {isZh ? '立即订阅' : 'Subscribe Now'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recharge Tab */}
        {activeTab === 'recharge' && (
          <>
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-4">{t.selectPackage}</h2>
              <div className="grid grid-cols-2 gap-3">
                {PAYMENT_PACKAGES.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPackage(pkg.id)}
                    className={`relative p-4 rounded-[20px] border-2 transition-all ${
                      selectedPackage === pkg.id
                        ? 'border-black bg-gray-50 shadow-lg scale-105'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {pkg.popular && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#fe4a22] text-white text-xs px-3 py-1 rounded-full font-semibold">
                        {t.popular}
                      </div>
                    )}
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 mb-2">
                        <Zap className="w-5 h-5 text-[#fe4a22]" />
                        <span className="text-2xl font-bold text-gray-800">{pkg.energy}</span>
                      </div>
                      {pkg.bonus > 0 && (
                        <div className="text-xs text-[#fe4a22] font-semibold mb-2">+{pkg.bonus}% {t.bonus}</div>
                      )}
                      <div className="text-lg font-bold text-black">${pkg.price}</div>
                    </div>
                    {selectedPackage === pkg.id && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-black rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-4">{t.paymentMethod}</h2>
              <div className="space-y-3">
                <button
                  onClick={() => setPaymentMethod('stripe')}
                  className={`w-full p-4 rounded-[20px] border-2 flex items-center gap-4 transition-all ${
                    paymentMethod === 'stripe' ? 'border-black bg-gray-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center">
                    <CreditCard className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-gray-800">Stripe</p>
                    <p className="text-sm text-gray-500">Credit Card / Apple Pay / Google Pay</p>
                  </div>
                  {paymentMethod === 'stripe' && <Check className="w-6 h-6 text-black" />}
                </button>
                <button
                  onClick={() => setPaymentMethod('web3')}
                  className={`w-full p-4 rounded-[20px] border-2 flex items-center gap-4 transition-all ${
                    paymentMethod === 'web3' ? 'border-black bg-gray-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center">
                    <Smartphone className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-gray-800">Web3</p>
                    <p className="text-sm text-gray-500">USDC / USDT / ETH</p>
                  </div>
                  {paymentMethod === 'web3' && <Check className="w-6 h-6 text-black" />}
                </button>
              </div>
            </div>

            <button
              onClick={handlePurchase}
              disabled={processing}
              className="w-full py-4 bg-black text-white font-bold rounded-[20px] hover:bg-gray-900 transition-all disabled:opacity-50"
            >
              {processing ? t.processing : `${t.payNow} $${PAYMENT_PACKAGES.find(p => p.id === selectedPackage)?.price}`}
            </button>
            <p className="text-xs text-gray-500 text-center px-4">{t.paymentTerms}</p>
          </>
        )}

        {/* Earn Energy Tab */}
        {activeTab === 'earn' && (
          <>
            {/* Daily Tasks */}
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-4">
                {isZh ? '每日任务' : 'Daily Tasks'}
              </h2>
              <div className="space-y-3">
                {/* Check-in */}
                <div className="bg-white rounded-[20px] p-4 border border-gray-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-gray-700" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">{isZh ? '每日签到' : 'Daily Check-in'}</p>
                      <p className="text-sm text-gray-500">{isZh ? `连续 ${checkInStreak} 天` : `${checkInStreak} day streak`}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-[#fe4a22] font-bold mb-2">
                        <Zap className="w-4 h-4" />+50
                      </div>
                      <button
                        onClick={handleCheckIn}
                        disabled={!canCheckInToday()}
                        className={`px-4 py-1.5 rounded-full text-sm font-semibold ${
                          !canCheckInToday()
                            ? 'bg-gray-100 text-gray-400'
                            : 'bg-black text-white hover:bg-gray-900'
                        }`}
                      >
                        {!canCheckInToday() ? (isZh ? '已签到' : 'Done') : (isZh ? '签到' : 'Check In')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Invite */}
                <div className="bg-white rounded-[20px] p-4 border border-gray-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-gray-700" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">{isZh ? '邀请好友' : 'Invite Friends'}</p>
                      <p className="text-sm text-gray-500">{isZh ? '每邀请1人获得200能量' : '200 energy per invite'}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-[#fe4a22] font-bold mb-2">
                        <Zap className="w-4 h-4" />+200
                      </div>
                      <button
                        onClick={() => { addEnergy(200); alert(isZh ? '邀请成功！+200' : 'Invited! +200'); }}
                        className="px-4 py-1.5 rounded-full text-sm font-semibold bg-black text-white hover:bg-gray-900"
                      >
                        {isZh ? '邀请' : 'Invite'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Share */}
                <div className="bg-white rounded-[20px] p-4 border border-gray-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <Share2 className="w-6 h-6 text-gray-700" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">{isZh ? '分享任务' : 'Share'}</p>
                      <p className="text-sm text-gray-500">{isZh ? '分享到社交媒体' : 'Share to social media'}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-[#fe4a22] font-bold mb-2">
                        <Zap className="w-4 h-4" />+20
                      </div>
                      <button
                        onClick={() => { addEnergy(20); alert(isZh ? '分享成功！+20' : 'Shared! +20'); }}
                        className="px-4 py-1.5 rounded-full text-sm font-semibold bg-black text-white hover:bg-gray-900"
                      >
                        {isZh ? '分享' : 'Share'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Loot Boxes */}
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-4">
                {t.lootBox}
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {LOOT_BOXES.map((box) => (
                  <button
                    key={box.id}
                    onClick={() => handleOpenBox(box)}
                    className="bg-white rounded-[20px] p-4 border border-gray-100 text-center transition-transform active:scale-[0.95]"
                  >
                    <div className={`w-12 h-12 ${box.color} rounded-full mx-auto mb-2 flex items-center justify-center`}>
                      <Package className="w-6 h-6 text-white" />
                    </div>
                    <p className="font-semibold text-gray-800 text-sm">
                      {isZh ? box.nameZh : box.nameEn}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {box.minReward}-{box.maxReward}
                    </p>
                    <div className="flex items-center justify-center gap-1 text-[#fe4a22] font-bold text-sm mt-2">
                      <Zap className="w-3.5 h-3.5" />{box.cost}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Streak bonus */}
            {checkInStreak >= 7 && (
              <div className="bg-gray-50 border border-gray-200 rounded-[20px] p-4 flex items-center gap-3">
                <Trophy className="w-8 h-8 text-[#fe4a22]" />
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">
                    {isZh ? `连续签到 ${checkInStreak} 天！` : `${checkInStreak} Day Streak!`}
                  </p>
                  <p className="text-xs text-gray-600">
                    {isZh
                      ? checkInStreak >= 30 ? '已获得 500 能量奖励！' : `再坚持 ${30 - checkInStreak} 天获得 500 能量`
                      : checkInStreak >= 30 ? 'Earned 500 energy bonus!' : `${30 - checkInStreak} more days for 500 energy`}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
