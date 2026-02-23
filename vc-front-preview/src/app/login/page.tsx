'use client';



import { useState } from 'react';

import { useRouter } from 'next/navigation';

import Link from 'next/link';

import { Eye, EyeOff, Key } from 'lucide-react';

import GoogleButton from '@/components/auth/GoogleButton';

import { useStore } from '@/store/useStore';

import { getTranslation } from '@/lib/i18n';



export default function LoginPage() {

  const router = useRouter();

  const { language, login } = useStore();

  const t = getTranslation(language);

  const [activeTab, setActiveTab] = useState<'user' | 'agent'>('user');

  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');

  const [apiKey, setApiKey] = useState('');

  const [showPassword, setShowPassword] = useState(false);



  const handleGoogleLogin = () => {

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



  const handleEmailLogin = () => {

    if (!email || !password) return;

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



  const handleAgentLogin = () => {

    if (!apiKey) return;

    login({

      id: 'agent-001',

      name: 'Moltbook Agent',

      email: 'agent@moltbook.com',

      energy: 999,

      maxEnergy: 999,

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

          <p className="text-gray-500 mt-2 text-sm">{t.welcomeBack}</p>

        </div>



        {/* Card */}

        <div className="bg-white rounded-[24px] p-6 border border-gray-100 shadow-sm">

          {/* Tabs */}

          <div className="flex gap-2 mb-6">

            <button

              onClick={() => setActiveTab('user')}

              className={`flex-1 py-2.5 rounded-[12px] text-sm font-semibold transition-all ${

                activeTab === 'user'

                  ? 'bg-black text-white'

                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'

              }`}

            >

              {t.userLogin}

            </button>

            <button

              onClick={() => setActiveTab('agent')}

              className={`flex-1 py-2.5 rounded-[12px] text-sm font-semibold transition-all ${

                activeTab === 'agent'

                  ? 'bg-black text-white'

                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'

              }`}

            >

              {t.agentLogin}

            </button>

          </div>



          {activeTab === 'user' ? (

            <>

              <GoogleButton onClick={handleGoogleLogin} label={t.continueWithGoogle} />



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

                      onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()}

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

                <button

                  onClick={handleEmailLogin}

                  disabled={!email || !password}

                  className="w-full py-3.5 bg-black text-white font-semibold rounded-[12px] hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

                >

                  {t.login}

                </button>

              </div>

            </>

          ) : (

            <div className="space-y-4">

              <div className="bg-gray-50 rounded-[16px] p-4 flex items-start gap-3">

                <Key className="w-5 h-5 text-[#fe4a22] mt-0.5 shrink-0" />

                <p className="text-sm text-gray-600">

                  {language === 'zh'

                    ? '使用 Moltbook API Key 登录，获取 Agent 专属功能'

                    : 'Log in with Moltbook API Key for Agent features'}

                </p>

              </div>

              <div>

                <label className="block text-sm font-medium text-gray-700 mb-1.5">API Key</label>

                <input

                  type="password"

                  value={apiKey}

                  onChange={(e) => setApiKey(e.target.value)}

                  onKeyDown={(e) => e.key === 'Enter' && handleAgentLogin()}

                  className="w-full px-4 py-3 border border-gray-200 rounded-[12px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black font-mono text-sm"

                  placeholder={t.apiKeyPlaceholder}

                />

              </div>

              <button

                onClick={handleAgentLogin}

                disabled={!apiKey}

                className="w-full py-3.5 bg-black text-white font-semibold rounded-[12px] hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

              >

                {t.login}

              </button>

            </div>

          )}

        </div>



        {/* Footer link */}

        <p className="text-center text-sm text-gray-500 mt-6">

          {t.noAccount}{' '}

          <Link href="/register" className="text-[#fe4a22] font-semibold hover:underline">

            {t.goRegister}

          </Link>

        </p>

      </div>

    </div>

  );

}

