'use client';

import { useState } from 'react';
import { ChevronLeft, Globe, Bell, Shield, HelpCircle, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { getTranslation } from '@/lib/i18n';

export default function SettingsPage() {
  const router = useRouter();
  const { language, setLanguage } = useStore();
  const t = getTranslation(language);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const handleLanguageChange = (lang: 'en' | 'zh') => {
    setLanguage(lang);
    setShowLanguageModal(false);
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-pink-50/30 to-white">
      {/* Header */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-10">
        <div className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14">
          <button
            onClick={() => router.back()}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="w-6 h-6 text-gray-700" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">{t.settings}</h1>
        </div>
      </div>

      <div className="px-5 py-6 max-w-2xl mx-auto">
        {/* Language Section */}
        <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 mb-4 overflow-hidden">
          <button
            onClick={() => setShowLanguageModal(true)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-800">{t.language}</div>
                <div className="text-sm text-gray-500">
                  {language === 'en' ? 'English' : '中文'}
                </div>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
          </button>
        </div>

        {/* Notifications Section */}
        <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 mb-4 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-teal-400 flex items-center justify-center">
                <Bell className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-800">{t.notifications}</div>
                <div className="text-sm text-gray-500">{t.manageNotifications}</div>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
          </button>
        </div>

        {/* Privacy Section */}
        <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 mb-4 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-800">{t.privacy}</div>
                <div className="text-sm text-gray-500">{t.privacySettings}</div>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
          </button>
        </div>

        {/* Help & Support Section */}
        <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 mb-4 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-400 flex items-center justify-center">
                <HelpCircle className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-800">{t.helpSupport}</div>
                <div className="text-sm text-gray-500">{t.getHelp}</div>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
          </button>
        </div>

        {/* Logout Button */}
        <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 overflow-hidden">
          <button
            onClick={() => {
              // Handle logout logic here
              router.push('/');
            }}
            className="w-full flex items-center justify-between p-4 hover:bg-red-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-400 to-rose-400 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <div className="font-medium text-red-600">{t.logout}</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Language Modal */}
      {showLanguageModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-md sm:rounded-[20px] rounded-t-[20px] p-6 animate-slide-up">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">{t.selectLanguage}</h2>
            <div className="space-y-3">
              <button
                onClick={() => handleLanguageChange('en')}
                className={`w-full flex items-center justify-between p-4 rounded-[20px] border-2 transition-all ${
                  language === 'en'
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="font-medium text-gray-800">English</span>
                {language === 'en' && (
                  <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
              <button
                onClick={() => handleLanguageChange('zh')}
                className={`w-full flex items-center justify-between p-4 rounded-[20px] border-2 transition-all ${
                  language === 'zh'
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="font-medium text-gray-800">中文</span>
                {language === 'zh' && (
                  <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            </div>
            <button
              onClick={() => setShowLanguageModal(false)}
              className="w-full mt-4 py-3 rounded-[20px] bg-gray-100 hover:bg-gray-200 transition-colors font-medium text-gray-700"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
