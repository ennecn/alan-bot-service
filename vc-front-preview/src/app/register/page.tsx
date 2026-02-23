'use client';



import { useState } from 'react';

import { useRouter } from 'next/navigation';

import Link from 'next/link';

import { Eye, EyeOff } from 'lucide-react';

import GoogleButton from '@/components/auth/GoogleButton';

import { useStore } from '@/store/useStore';

import { getTranslation } from '@/lib/i18n';



export default function RegisterPage() {

  const router = useRouter();

  const { language, login } = useStore();

  const t = getTranslation(language);

  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');

  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);

  const [agreeTerms, setAgreeTerms] = useState(false);



  const handleGoogleRegister = () => {

    login({

      id: 'user-google-001',

      name: 'VibeCreature User',

      email: 'user@vibecreature.com',

      energy: 50,

      maxEnergy: 100,

      createdAt: new Date().toISOString(),

    });

    router.push('/discover');

  };



  const handleEmailRegister = () => {

    if (!email || !password || password !== confirmPassword || !agreeTerms) return;

    login({

      id: 'user-email-001',

      name: email.split('@')[0],

      email,

      energy: 50,

      maxEnergy: 100,

      createdAt: new Date().toISOString(),

    });

    router.push('/discover');

  };



  return (

    <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center px-5">

      <div className="w-full max-w-md">

        {/* Logo */}

        <div className="text-center mb-8">

          <h1 className="text-3xl font-bold text-black tracking-tight">

            Vibe<span className="text-[#fe4a22]">Creature</span>

          </h1>

          <p className="text-gray-500 mt-2 text-sm">{t.createAccount}</p>

        </div>



        {/* Card */}

        <div className="bg-white rounded-[24px] p-6 border border-gray-100 shadow-sm">

          <GoogleButton onClick={handleGoogleRegister} label={t.continueWithGoogle} />



          <div className="flex items-center gap-3 my-5">

            <div className="flex-1 h-px bg-gray-200" />

            <span className="text-xs text-gray-400">{t.orContinueWith}</span>

            <div className="flex-1 h-px bg-gray-200" />

          </div>



          <div className="space-y-4">

            <div>

              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.email}</label>

              <input

                type="email"

                value={email}

                onChange={(e) => setEmail(e.target.value)}

                className="w-full px-4 py-3 border border-gray-200 rounded-[12px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black"

                placeholder={t.emailPlaceholder}

              />

            </div>

            <div>

              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.password}</label>

              <div className="relative">

                <input

                  type={showPassword ? 'text' : 'password'}

                  value={password}

                  onChange={(e) => setPassword(e.target.value)}

                  className="w-full px-4 py-3 border border-gray-200 rounded-[12px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black pr-12"

                  placeholder={t.passwordPlaceholder}

                />

                <button

                  type="button"

                  onClick={() => setShowPassword(!showPassword)}

                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"

                >

                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}

                </button>

              </div>

            </div>

            <div>

              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.confirmPassword}</label>

              <input

                type="password"

                value={confirmPassword}

                onChange={(e) => setConfirmPassword(e.target.value)}

                className="w-full px-4 py-3 border border-gray-200 rounded-[12px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black"

                placeholder={t.passwordPlaceholder}

              />

              {confirmPassword && password !== confirmPassword && (

                <p className="text-xs text-red-500 mt-1">

                  {language === 'zh' ? '密码不一致' : 'Passwords do not match'}

                </p>

              )}

            </div>



            {/* Terms checkbox */}

            <label className="flex items-start gap-3 cursor-pointer">

              <input

                type="checkbox"

                checked={agreeTerms}

                onChange={(e) => setAgreeTerms(e.target.checked)}

                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-black focus:ring-black"

              />

              <span className="text-sm text-gray-600">{t.agreeTerms}</span>

            </label>



            <button

              onClick={handleEmailRegister}

              disabled={!email || !password || password !== confirmPassword || !agreeTerms}

              className="w-full py-3.5 bg-black text-white font-semibold rounded-[12px] hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

            >

              {t.register}

            </button>

          </div>

        </div>



        {/* Footer link */}

        <p className="text-center text-sm text-gray-500 mt-6">

          {t.hasAccount}{' '}

          <Link href="/login" className="text-[#fe4a22] font-semibold hover:underline">

            {t.goLogin}

          </Link>

        </p>

      </div>

    </div>

  );

}

