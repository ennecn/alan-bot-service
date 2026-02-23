'use client';

import { useRouter } from 'next/navigation';
import { X, Sparkles, Gift, Share2, Calendar } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';

interface LowEnergyModalProps {
  isOpen: boolean;
  onClose: () => void;
  required: number;
}

export default function LowEnergyModal({ isOpen, onClose, required }: LowEnergyModalProps) {
  const router = useRouter();
  const { energy, language } = useStore();
  const t = getTranslation(language);

  if (!isOpen) return null;

  const handleRecharge = () => {
    onClose();
    router.push('/payment');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-[24px] max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="relative p-6 pb-4">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-purple-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">
              {language === 'zh' ? '能量不足啦 🥺' : 'Low Energy 🥺'}
            </h2>
            <div className="flex items-center justify-center gap-4 text-sm">
              <div>
                <p className="text-gray-500">{language === 'zh' ? '当前能量' : 'Current'}</p>
                <p className="text-2xl font-bold text-gray-800">{energy}</p>
              </div>
              <div className="text-gray-300 text-2xl">→</div>
              <div>
                <p className="text-gray-500">{language === 'zh' ? '需要能量' : 'Required'}</p>
                <p className="text-2xl font-bold text-purple-600">{required}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-3">
          <p className="text-center text-gray-600 text-sm mb-4">
            {language === 'zh'
              ? '要不要做个小任务赚点能量？'
              : 'Want to earn some energy with tasks?'}
          </p>

          {/* Recharge Button */}
          <button
            onClick={handleRecharge}
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-4 rounded-[20px] shadow-lg hover:shadow-xl transition-all active:scale-95"
          >
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5" />
              <span>{language === 'zh' ? '充值能量' : 'Recharge Energy'}</span>
            </div>
            <p className="text-xs opacity-90 mt-1">
              {language === 'zh' ? '快速获得大量能量' : 'Get energy instantly'}
            </p>
          </button>

          {/* Free Options */}
          <div className="space-y-2">
            <p className="text-xs text-gray-500 text-center">
              {language === 'zh' ? '或者免费获取能量：' : 'Or earn free energy:'}
            </p>

            <button className="w-full bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-100 py-3 px-4 rounded-[16px] flex items-center gap-3 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-cyan-400 rounded-full flex items-center justify-center">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-800 text-sm">
                  {language === 'zh' ? '每日签到' : 'Daily Check-in'}
                </p>
                <p className="text-xs text-gray-500">+10 {language === 'zh' ? '能量' : 'energy'}</p>
              </div>
            </button>

            <button className="w-full bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 py-3 px-4 rounded-[16px] flex items-center gap-3 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-400 rounded-full flex items-center justify-center">
                <Share2 className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-800 text-sm">
                  {language === 'zh' ? '分享给朋友' : 'Share with Friends'}
                </p>
                <p className="text-xs text-gray-500">+20 {language === 'zh' ? '能量' : 'energy'}</p>
              </div>
            </button>

            <button className="w-full bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-100 py-3 px-4 rounded-[16px] flex items-center gap-3 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-400 rounded-full flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-800 text-sm">
                  {language === 'zh' ? '创作内容' : 'Create Content'}
                </p>
                <p className="text-xs text-gray-500">+30 {language === 'zh' ? '能量' : 'energy'}</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
