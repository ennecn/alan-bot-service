'use client';



import { useState } from 'react';

import { useRouter } from 'next/navigation';

import {

  Sparkles,

  Settings,

  Upload,

  ChevronRight,

  X,

  Check,

  ChevronLeft,

  Plus,

  Wand2,

  Image

} from 'lucide-react';

import { useStore } from '@/store/useStore';

import { getTranslation } from '@/lib/i18n';

import type { Species } from '@/data/mock';



type CreateMode = 'select' | 'simple' | 'detailed' | 'import';



const personalityTemplates = [

  { id: 'gentle', name: '温柔体贴型', nameEn: 'Gentle & Caring', emoji: '🌸' },

  { id: 'cheerful', name: '活泼开朗型', nameEn: 'Cheerful & Lively', emoji: '☀️' },

  { id: 'elegant', name: '知性优雅型', nameEn: 'Elegant & Wise', emoji: '📚' },

  { id: 'mysterious', name: '神秘冷酷型', nameEn: 'Mysterious & Cool', emoji: '🌙' },

  { id: 'humorous', name: '幽默风趣型', nameEn: 'Humorous & Witty', emoji: '😄' },

];



const professionOptions = [

  { id: 'warrior', name: '战士', nameEn: 'Warrior' },

  { id: 'mage', name: '法师', nameEn: 'Mage' },

  { id: 'healer', name: '治愈师', nameEn: 'Healer' },

  { id: 'scholar', name: '学者', nameEn: 'Scholar' },

  { id: 'artist', name: '艺术家', nameEn: 'Artist' },

  { id: 'merchant', name: '商人', nameEn: 'Merchant' },

  { id: 'assassin', name: '刺客', nameEn: 'Assassin' },

  { id: 'noble', name: '贵族', nameEn: 'Noble' },

  { id: 'explorer', name: '探险家', nameEn: 'Explorer' },

  { id: 'guardian', name: '守护者', nameEn: 'Guardian' },

  { id: 'musician', name: '乐师', nameEn: 'Musician' },

];



const importSources = [

  { id: 'sillytavern', name: 'SillyTavern', format: '.json', icon: '📝' },

  { id: 'moltbook', name: 'Moltbook', format: '.json', icon: '📚' },

  { id: 'characterai', name: 'Character.AI', format: 'link', icon: '🤖' },

  { id: 'poe', name: 'Poe', format: 'link', icon: '🎭' },

];



const allSpecies: { value: Species; name: string; nameEn: string }[] = [

  { value: 'human', name: '人', nameEn: 'Human' },

  { value: 'beast', name: '兽', nameEn: 'Beast' },

  { value: 'immortal', name: '仙', nameEn: 'Immortal' },

  { value: 'demon', name: '魔', nameEn: 'Demon' },

  { value: 'elf', name: '精灵', nameEn: 'Elf' },

  { value: 'dragon', name: '龙', nameEn: 'Dragon' },

  { value: 'vampire', name: '血族', nameEn: 'Vampire' },

  { value: 'angel', name: '天使', nameEn: 'Angel' },

  { value: 'robot', name: '机械', nameEn: 'Robot' },

  { value: 'hybrid', name: '混血', nameEn: 'Hybrid' },

  { value: 'other', name: '其他', nameEn: 'Other' },

];



export default function CreatePage() {

  const router = useRouter();

  const { language } = useStore();

  const t = getTranslation(language);

  const isZh = language === 'zh';



  const [mode, setMode] = useState<CreateMode>('select');

  const [name, setName] = useState('');

  const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('');

  const [age, setAge] = useState('');

  const [species, setSpecies] = useState<Species | ''>('');

  const [personality, setPersonality] = useState('');

  const [profession, setProfession] = useState('');

  const [customProfession, setCustomProfession] = useState('');

  const [bio, setBio] = useState('');

  const [world, setWorld] = useState('');

  const [tags, setTags] = useState<string[]>([]);

  const [tagInput, setTagInput] = useState('');

  const [photos, setPhotos] = useState<string[]>([]);

  const [importSource, setImportSource] = useState('');

  const [importLink, setImportLink] = useState('');



  const addTag = () => {

    const trimmed = tagInput.trim();

    if (trimmed && !tags.includes(trimmed)) {

      setTags([...tags, trimmed]);

      setTagInput('');

    }

  };



  const removeTag = (tag: string) => {

    setTags(tags.filter((t) => t !== tag));

  };



  const handlePhotoUpload = () => {

    if (photos.length >= 9) return;

    setPhotos([...photos, `/placeholder-${photos.length + 1}.jpg`]);

  };



  const handleCreate = () => {

    alert(isZh ? '角色创建成功！' : 'Creature created successfully!');

    router.push('/discover');

  };



  const handleImport = () => {

    alert(isZh ? '导入成功！' : 'Import successful!');

    router.push('/discover');

  };



  // ─── Select Mode ───

  if (mode === 'select') {

    return (

      <div className="min-h-screen bg-white pb-24">

        {/* Header */}

        <div className="px-6 pt-14 pb-8">

          <h1 className="text-3xl font-bold text-black">{t.createTitle}</h1>

          <p className="text-gray-500 mt-2 text-sm">{t.createSubtitle}</p>

        </div>



        <div className="px-6 space-y-4">

          {/* Simple Setup Card */}

          <button

            onClick={() => setMode('simple')}

            className="w-full bg-black rounded-[20px] p-6 text-left transition-transform active:scale-[0.98]"

          >

            <div className="flex items-center justify-between">

              <div className="flex items-center gap-4">

                <div className="w-12 h-12 rounded-full bg-[#fe4a22] flex items-center justify-center">

                  <Sparkles className="w-6 h-6 text-white" />

                </div>

                <div>

                  <h3 className="text-white font-semibold text-lg">

                    {isZh ? '快速创建' : 'Quick Setup'}

                  </h3>

                  <p className="text-gray-400 text-sm mt-1">

                    {isZh ? '填写基本信息，快速生成角色' : 'Fill basic info, generate quickly'}

                  </p>

                </div>

              </div>

              <ChevronRight className="w-5 h-5 text-gray-500" />

            </div>

          </button>



          {/* Detailed Setup Card */}

          <button

            onClick={() => setMode('detailed')}

            className="w-full bg-gray-100 rounded-[20px] p-6 text-left transition-transform active:scale-[0.98]"

          >

            <div className="flex items-center justify-between">

              <div className="flex items-center gap-4">

                <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center">

                  <Settings className="w-6 h-6 text-white" />

                </div>

                <div>

                  <h3 className="text-black font-semibold text-lg">

                    {isZh ? '详细创建' : 'Detailed Setup'}

                  </h3>

                  <p className="text-gray-500 text-sm mt-1">

                    {isZh ? '自定义所有细节，打造专属角色' : 'Customize every detail'}

                  </p>

                </div>

              </div>

              <ChevronRight className="w-5 h-5 text-gray-400" />

            </div>

          </button>



          {/* Import Button */}

          <button

            onClick={() => setMode('import')}

            className="w-full bg-white border-2 border-gray-200 rounded-[20px] p-6 text-left transition-transform active:scale-[0.98]"

          >

            <div className="flex items-center justify-between">

              <div className="flex items-center gap-4">

                <div className="w-12 h-12 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center">

                  <Upload className="w-6 h-6 text-gray-700" />

                </div>

                <div>

                  <h3 className="text-black font-semibold text-lg">

                    {isZh ? '导入角色' : 'Import Character'}

                  </h3>

                  <p className="text-gray-500 text-sm mt-1">

                    {isZh ? '从其他平台导入已有角色' : 'Import from other platforms'}

                  </p>

                </div>

              </div>

              <ChevronRight className="w-5 h-5 text-gray-400" />

            </div>

          </button>

        </div>

      </div>

    );

  }



  // ─── Simple Mode ───

  if (mode === 'simple') {

    return (

      <div className="min-h-screen bg-white pb-24">

        {/* Header */}

        <div className="px-6 pt-14 pb-6 flex items-center gap-4">

          <button onClick={() => setMode('select')} className="p-1">

            <ChevronLeft className="w-6 h-6 text-black" />

          </button>

          <h1 className="text-xl font-bold text-black">

            {isZh ? '快速创建' : 'Quick Setup'}

          </h1>

        </div>



        <div className="px-6 space-y-6">

          {/* Name */}

          <div>

            <label className="text-sm font-medium text-black mb-2 block">{t.name}</label>

            <input

              type="text"

              value={name}

              onChange={(e) => setName(e.target.value)}

              placeholder={t.namePlaceholder}

              className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

            />

          </div>



          {/* Gender */}

          <div>

            <label className="text-sm font-medium text-black mb-2 block">{t.gender}</label>

            <div className="flex gap-3">

              {(['male', 'female', 'other'] as const).map((g) => (

                <button

                  key={g}

                  onClick={() => setGender(g)}

                  className={`flex-1 py-3 rounded-[16px] text-sm font-medium transition-colors ${

                    gender === g

                      ? 'bg-black text-white'

                      : 'bg-gray-100 text-gray-600'

                  }`}

                >

                  {g === 'male' ? t.male : g === 'female' ? t.female : (isZh ? '其他' : 'Other')}

                </button>

              ))}

            </div>

          </div>



          {/* Age */}

          <div>

            <label className="text-sm font-medium text-black mb-2 block">{t.age}</label>

            <input

              type="number"

              value={age}

              onChange={(e) => setAge(e.target.value)}

              placeholder={t.agePlaceholder}

              className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

            />

          </div>



          {/* Species Pills */}

          <div>

            <label className="text-sm font-medium text-black mb-2 block">{t.species}</label>

            <div className="flex flex-wrap gap-2">

              {allSpecies.map((s) => (

                <button

                  key={s.value}

                  onClick={() => setSpecies(s.value)}

                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${

                    species === s.value

                      ? 'bg-[#fe4a22] text-white'

                      : 'bg-gray-100 text-gray-600'

                  }`}

                >

                  {isZh ? s.name : s.nameEn}

                </button>

              ))}

            </div>

          </div>



          {/* Personality Template */}

          <div>

            <label className="text-sm font-medium text-black mb-2 block">

              {isZh ? '性格模板' : 'Personality'}

            </label>

            <div className="space-y-2">

              {personalityTemplates.map((p) => (

                <button

                  key={p.id}

                  onClick={() => setPersonality(p.id)}

                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-[16px] text-left transition-colors ${

                    personality === p.id

                      ? 'bg-black text-white'

                      : 'bg-gray-100 text-gray-700'

                  }`}

                >

                  <span className="text-lg">{p.emoji}</span>

                  <span className="text-sm font-medium">

                    {isZh ? p.name : p.nameEn}

                  </span>

                  {personality === p.id && (

                    <Check className="w-4 h-4 ml-auto" />

                  )}

                </button>

              ))}

            </div>

          </div>



          {/* Create Button */}

          <button

            onClick={handleCreate}

            disabled={!name || !gender || !species}

            className="w-full bg-black text-white py-4 rounded-[16px] font-semibold text-base disabled:opacity-40 transition-opacity active:scale-[0.98]"

          >

            {t.createCreature}

          </button>

        </div>

      </div>

    );

  }



  // ─── Import Mode ───

  if (mode === 'import') {

    return (

      <div className="min-h-screen bg-white pb-24">

        {/* Header */}

        <div className="px-6 pt-14 pb-6 flex items-center gap-4">

          <button onClick={() => setMode('select')} className="p-1">

            <ChevronLeft className="w-6 h-6 text-black" />

          </button>

          <h1 className="text-xl font-bold text-black">

            {isZh ? '导入角色' : 'Import Character'}

          </h1>

        </div>



        <div className="px-6 space-y-6">

          {/* Source Selection */}

          <div>

            <label className="text-sm font-medium text-black mb-3 block">

              {isZh ? '选择来源' : 'Select Source'}

            </label>

            <div className="grid grid-cols-2 gap-3">

              {importSources.map((src) => (

                <button

                  key={src.id}

                  onClick={() => setImportSource(src.id)}

                  className={`p-4 rounded-[20px] text-center transition-colors ${

                    importSource === src.id

                      ? 'bg-black text-white'

                      : 'bg-gray-100 text-gray-700'

                  }`}

                >

                  <span className="text-2xl block mb-2">{src.icon}</span>

                  <span className="text-sm font-medium">{src.name}</span>

                  <span className={`text-xs block mt-1 ${

                    importSource === src.id ? 'text-gray-300' : 'text-gray-400'

                  }`}>

                    {src.format}

                  </span>

                </button>

              ))}

            </div>

          </div>



          {/* File Upload or Link */}

          {importSource && (

            <div>

              {importSources.find((s) => s.id === importSource)?.format === 'link' ? (

                <div>

                  <label className="text-sm font-medium text-black mb-2 block">

                    {isZh ? '粘贴链接' : 'Paste Link'}

                  </label>

                  <input

                    type="url"

                    value={importLink}

                    onChange={(e) => setImportLink(e.target.value)}

                    placeholder={isZh ? '输入角色页面链接...' : 'Enter character page URL...'}

                    className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

                  />

                </div>

              ) : (

                <button className="w-full border-2 border-dashed border-gray-300 rounded-[20px] p-8 flex flex-col items-center gap-3 transition-colors hover:border-[#fe4a22]">

                  <Upload className="w-8 h-8 text-gray-400" />

                  <span className="text-sm text-gray-500">

                    {isZh ? '点击上传 .json 文件' : 'Click to upload .json file'}

                  </span>

                </button>

              )}

            </div>

          )}



          {/* Import Button */}

          <button

            onClick={handleImport}

            disabled={!importSource || (importSources.find((s) => s.id === importSource)?.format === 'link' && !importLink)}

            className="w-full bg-black text-white py-4 rounded-[16px] font-semibold text-base disabled:opacity-40 transition-opacity active:scale-[0.98]"

          >

            {isZh ? '开始导入' : 'Start Import'}

          </button>

        </div>

      </div>

    );

  }



  // ─── Detailed Mode ───

  return (

    <div className="min-h-screen bg-white pb-24">

      {/* Header */}

      <div className="px-6 pt-14 pb-6 flex items-center gap-4">

        <button onClick={() => setMode('select')} className="p-1">

          <ChevronLeft className="w-6 h-6 text-black" />

        </button>

        <h1 className="text-xl font-bold text-black">

          {isZh ? '详细创建' : 'Detailed Setup'}

        </h1>

      </div>



      <div className="px-6 space-y-6">

        {/* Name */}

        <div>

          <label className="text-sm font-medium text-black mb-2 block">{t.name}</label>

          <input

            type="text"

            value={name}

            onChange={(e) => setName(e.target.value)}

            placeholder={t.namePlaceholder}

            className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

          />

        </div>



        {/* Gender */}

        <div>

          <label className="text-sm font-medium text-black mb-2 block">{t.gender}</label>

          <div className="flex gap-3">

            {(['male', 'female', 'other'] as const).map((g) => (

              <button

                key={g}

                onClick={() => setGender(g)}

                className={`flex-1 py-3 rounded-[16px] text-sm font-medium transition-colors ${

                  gender === g

                    ? 'bg-black text-white'

                    : 'bg-gray-100 text-gray-600'

                }`}

              >

                {g === 'male' ? t.male : g === 'female' ? t.female : (isZh ? '其他' : 'Other')}

              </button>

            ))}

          </div>

        </div>



        {/* Age */}

        <div>

          <label className="text-sm font-medium text-black mb-2 block">{t.age}</label>

          <input

            type="number"

            value={age}

            onChange={(e) => setAge(e.target.value)}

            placeholder={t.agePlaceholder}

            className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

          />

        </div>



        {/* Species Pills */}

        <div>

          <label className="text-sm font-medium text-black mb-2 block">{t.species}</label>

          <div className="flex flex-wrap gap-2">

            {allSpecies.map((s) => (

              <button

                key={s.value}

                onClick={() => setSpecies(s.value)}

                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${

                  species === s.value

                    ? 'bg-[#fe4a22] text-white'

                    : 'bg-gray-100 text-gray-600'

                }`}

              >

                {isZh ? s.name : s.nameEn}

              </button>

            ))}

          </div>

        </div>



        {/* Profession Dropdown + Custom */}

        <div>

          <label className="text-sm font-medium text-black mb-2 block">{t.profession}</label>

          <select

            value={profession}

            onChange={(e) => {

              setProfession(e.target.value);

              if (e.target.value !== 'custom') setCustomProfession('');

            }}

            className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black outline-none focus:ring-2 focus:ring-[#fe4a22] appearance-none"

          >

            <option value="">{t.professionSelect}</option>

            {professionOptions.map((p) => (

              <option key={p.id} value={p.id}>

                {isZh ? p.name : p.nameEn}

              </option>

            ))}

            <option value="custom">{t.customProfession}</option>

          </select>

          {profession === 'custom' && (

            <input

              type="text"

              value={customProfession}

              onChange={(e) => setCustomProfession(e.target.value)}

              placeholder={t.professionPlaceholder}

              className="w-full bg-gray-100 rounded-[16px] px-4 py-3 mt-2 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

            />

          )}

        </div>



        {/* Bio / Intro */}

        <div>

          <div className="flex items-center justify-between mb-2">

            <label className="text-sm font-medium text-black">{t.bio}</label>

            <button

              onClick={() => alert(isZh ? 'AI 优化人设功能开发中...' : 'AI Optimize Persona coming soon...')}

              className="flex items-center gap-1 text-xs text-[#fe4a22] font-medium"

            >

              <Wand2 className="w-3.5 h-3.5" />

              {t.aiOptimizePersona}

            </button>

          </div>

          <textarea

            value={bio}

            onChange={(e) => setBio(e.target.value)}

            placeholder={t.bioPlaceholder}

            rows={4}

            className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22] resize-none"

          />

        </div>



        {/* World */}

        <div>

          <div className="flex items-center justify-between mb-2">

            <label className="text-sm font-medium text-black">

              {isZh ? '世界观' : 'World Setting'}

            </label>

            <button

              onClick={() => alert(isZh ? 'AI 优化世界观功能开发中...' : 'AI Optimize World coming soon...')}

              className="flex items-center gap-1 text-xs text-[#fe4a22] font-medium"

            >

              <Wand2 className="w-3.5 h-3.5" />

              {t.aiOptimizeWorld}

            </button>

          </div>

          <textarea

            value={world}

            onChange={(e) => setWorld(e.target.value)}

            placeholder={isZh ? '描述角色所在的世界背景...' : 'Describe the world setting...'}

            rows={3}

            className="w-full bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22] resize-none"

          />

        </div>



        {/* Tags */}

        <div>

          <label className="text-sm font-medium text-black mb-2 block">{t.tags}</label>

          <div className="flex gap-2">

            <input

              type="text"

              value={tagInput}

              onChange={(e) => setTagInput(e.target.value)}

              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}

              placeholder={t.tagsPlaceholder}

              className="flex-1 bg-gray-100 rounded-[16px] px-4 py-3 text-black placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#fe4a22]"

            />

            <button

              onClick={addTag}

              className="w-12 h-12 bg-black rounded-[16px] flex items-center justify-center"

            >

              <Plus className="w-5 h-5 text-white" />

            </button>

          </div>

          {tags.length > 0 && (

            <div className="flex flex-wrap gap-2 mt-3">

              {tags.map((tag) => (

                <span

                  key={tag}

                  className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full text-sm"

                >

                  {tag}

                  <button onClick={() => removeTag(tag)}>

                    <X className="w-3.5 h-3.5 text-gray-400" />

                  </button>

                </span>

              ))}

            </div>

          )}

        </div>



        {/* Photo Upload (max 9) */}

        <div>

          <div className="flex items-center justify-between mb-2">

            <label className="text-sm font-medium text-black">{t.uploadPhotos}</label>

            <button

              onClick={() => alert(isZh ? 'AI 生成外观功能开发中...' : 'AI Generate Appearance coming soon...')}

              className="flex items-center gap-1 text-xs text-[#fe4a22] font-medium"

            >

              <Wand2 className="w-3.5 h-3.5" />

              {t.aiGenerateAppearance}

            </button>

          </div>

          <div className="grid grid-cols-3 gap-3">

            {photos.map((_, i) => (

              <div

                key={i}

                className="aspect-square bg-gray-200 rounded-[16px] flex items-center justify-center relative"

              >

                <Image className="w-6 h-6 text-gray-400" />

                <button

                  onClick={() => setPhotos(photos.filter((__, idx) => idx !== i))}

                  className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-black rounded-full flex items-center justify-center"

                >

                  <X className="w-3.5 h-3.5 text-white" />

                </button>

              </div>

            ))}

            {photos.length < 9 && (

              <button

                onClick={handlePhotoUpload}

                className="aspect-square border-2 border-dashed border-gray-300 rounded-[16px] flex flex-col items-center justify-center gap-1 transition-colors hover:border-[#fe4a22]"

              >

                <Plus className="w-6 h-6 text-gray-400" />

                <span className="text-xs text-gray-400">{photos.length}/9</span>

              </button>

            )}

          </div>

        </div>



        {/* Create Button */}

        <button

          onClick={handleCreate}

          disabled={!name || !gender || !species}

          className="w-full bg-black text-white py-4 rounded-[16px] font-semibold text-base disabled:opacity-40 transition-opacity active:scale-[0.98]"

        >

          {t.createCreature}

        </button>

      </div>

    </div>

  );

}

