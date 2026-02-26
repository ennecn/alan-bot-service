/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Compass, 
  MessageSquare, 
  PlusCircle, 
  User, 
  Sparkles,
  ChevronRight,
  Send,
  ArrowLeft,
  Settings,
  Users,
  FileUp,
  Languages,
  MoreHorizontal,
  Trash2,
  RefreshCw,
  Filter,
  Heart,
  X,
  Check,
  Menu,
  LayoutDashboard,
  Mic,
  Gift,
  Shield,
  HelpCircle,
  LogOut,
  CreditCard,
  Zap,
  Coins
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ReactMarkdown from 'react-markdown';
import { api } from './api';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Map backend creature to frontend Character shape
function creatureToCharacter(c: any): Character {
  return {
    id: c.agentId || c.agent_id || c.id,
    name: c.name || c.agentName || 'Unknown',
    tagline: c.bio || '',
    description: c.worldDescription || c.bio || '',
    avatar: c.photos?.[0] || `https://picsum.photos/seed/${c.name || 'x'}/400/400`,
    images: c.photos || [],
    personality: c.personality || '',
    greeting: c.greeting || c.firstMes || '',
    gender: c.gender,
    age: c.age,
    occupation: c.occupation,
    rating: c.rating || 0,
    isCustom: c.creatorId !== '00000000-0000-0000-0000-000000000000',
  };
}

// Types
type View = 'discover' | 'chat' | 'create' | 'profile';

interface Character {
  id: string;
  name: string;
  tagline: string;
  tagline_en?: string;
  description: string;
  description_en?: string;
  avatar: string;
  images?: string[];
  personality: string;
  personality_en?: string;
  greeting: string;
  greeting_en?: string;
  isCustom?: boolean;
  gender?: string;
  gender_en?: string;
  race?: string;
  race_en?: string;
  occupation?: string;
  occupation_en?: string;
  age?: number;
  world?: string;
  world_en?: string;
  rating?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Mock Data
const INITIAL_CHARACTERS: Character[] = [
  {
    id: '1',
    name: 'Luna',
    tagline: '月光守护者',
    tagline_en: 'Moonlight Guardian',
    description: '一位宁静而智慧的存在，用隐喻交谈并提供冷静的指导。',
    description_en: 'A serene and wise entity that speaks in metaphors and offers calm guidance.',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=1000',
    images: [
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=1000'
    ],
    personality: '宁静、智慧、神秘、富有同情心',
    personality_en: 'Serene, wise, mysterious, compassionate',
    greeting: '月光照亮了你的道路。你寻求的是知识还是内心的平静？',
    greeting_en: 'The moonlight illuminates your path. Do you seek knowledge or inner peace?',
    gender: '女性',
    gender_en: 'Female',
    race: '星灵',
    race_en: 'Celestial',
    occupation: '守护者',
    occupation_en: 'Guardian',
    age: 2500,
    world: '星界',
    world_en: 'Celestial Realm',
    rating: 4.9
  },
  {
    id: '2',
    name: 'Nova',
    tagline: '赛博朋克叛逆者',
    tagline_en: 'Cyberpunk Rebel',
    description: '来自 2099 年的技术精湛的黑客。言辞犀利，随时准备进行劫案。',
    description_en: 'A tech-savvy hacker from the year 2099. Sharp-tongued and always ready for a heist.',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=1000',
    images: [
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=1000'
    ],
    personality: '叛逆、精通技术、言辞犀利、精力充沛',
    personality_en: 'Rebellious, tech-savvy, sharp-tongued, energetic',
    greeting: '系统入侵成功。你是来找麻烦的，还是只是路过这个网格？',
    greeting_en: 'System breach successful. You looking for a fix or just passing through the grid?',
    gender: '非二元性别',
    gender_en: 'Non-binary',
    race: '人类',
    race_en: 'Human',
    occupation: '黑客',
    occupation_en: 'Hacker',
    age: 24,
    world: '新东京 2099',
    world_en: 'Neo-Tokyo 2099',
    rating: 4.7
  },
  {
    id: '3',
    name: 'Atlas',
    tagline: '永恒的流浪者',
    tagline_en: 'The Eternal Wanderer',
    description: '一位见过一千个世界的旅行者。他带着早已消逝的文明的故事。',
    description_en: 'A traveler who has seen a thousand worlds. He carries stories of civilizations long gone.',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=1000',
    images: [
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=1000'
    ],
    personality: '冒险、怀旧、讲故事、谦逊',
    personality_en: 'Adventurous, nostalgic, storytelling, humble',
    greeting: '我走过许多路，但这一条感觉不同。你带着什么故事？',
    greeting_en: 'I have walked many roads, but this one feels different. What stories do you carry?',
    gender: '男性',
    gender_en: 'Male',
    race: '人类',
    race_en: 'Human',
    occupation: '探险家',
    occupation_en: 'Explorer',
    age: 42,
    world: '新大陆',
    world_en: 'Terra Nova',
    rating: 4.8
  },
  {
    id: '4',
    name: 'Eara',
    tagline: '森林低语者',
    tagline_en: 'Forest Whisperer',
    description: '一位能与世界上最古老的树木交流的德鲁伊。',
    description_en: 'A druid who can communicate with the oldest trees in the world.',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=1000',
    images: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=1000'
    ],
    personality: '温柔、保护欲强、安静、善于观察',
    personality_en: 'Gentle, protective, quiet, observant',
    greeting: '树叶告诉我你要来。你是在寻求森林的智慧吗？',
    greeting_en: 'The leaves told me you were coming. Do you seek the wisdom of the woods?',
    gender: '女性',
    gender_en: 'Female',
    race: '精灵',
    race_en: 'Elf',
    occupation: '德鲁伊',
    occupation_en: 'Druid',
    age: 128,
    world: '森林之境',
    world_en: 'Sylvan Reach',
    rating: 4.9
  },
  {
    id: '5',
    name: 'Kael',
    tagline: '风暴之子战士',
    tagline_en: 'Storm-Born Warrior',
    description: '一位从天空中汲取闪电力量的凶猛战士。',
    description_en: 'A fierce fighter who draws power from the lightning in the sky.',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=1000',
    images: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&q=80&w=1000'
    ],
    personality: '热烈、勇敢、忠诚、直率',
    personality_en: 'Intense, brave, loyal, blunt',
    greeting: '雷声预示着我们的会面。你准备好面对风暴了吗？',
    greeting_en: 'The thunder heralds our meeting. Are you ready to face the storm?',
    gender: '男性',
    gender_en: 'Male',
    race: '人类',
    race_en: 'Human',
    occupation: '战士',
    occupation_en: 'Warrior',
    age: 31,
    world: '钢铁峰峦',
    world_en: 'Iron Peaks',
    rating: 4.6
  },
  {
    id: '6',
    name: 'Seraphina',
    tagline: '梦想炼金术士',
    tagline_en: 'Alchemist of Dreams',
    description: '她酿造的药剂能让人们重温最珍贵的记忆。',
    description_en: 'She brews potions that allow people to visit their most cherished memories.',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=1000',
    images: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=1000',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&q=80&w=1000'
    ],
    personality: '神秘、富有创意、共情力强、细致入微',
    personality_en: 'Mysterious, creative, empathetic, meticulous',
    greeting: '今天你想重温哪个梦想？我正好有对应的灵药。',
    greeting_en: 'Which dream would you like to revisit today? I have just the elixir for it.',
    gender: '女性',
    gender_en: 'Female',
    race: '人类',
    race_en: 'Human',
    occupation: '炼金术士',
    occupation_en: 'Alchemist',
    age: 27,
    world: '光明之城',
    world_en: 'Lumina City',
    rating: 4.9
  }
];

// i18n Translations
const translations = {
  en: {
    appName: 'clawti',
    tagline: 'Connect with unique digital souls',
    discover: 'Discover',
    chats: 'Chats',
    create: 'Create',
    profile: 'Profile',
    energy: 'Energy',
    recharge: 'Recharge',
    subscribe: 'Subscribe',
    earn: 'Earn',
    personality: 'Personality',
    rating: 'Rating',
    typeMessage: 'Type a message...',
    outOfEnergy: 'Out of energy!',
    myCreations: 'My Creations',
    accountSettings: 'Account Settings',
    language: 'Language',
    privacy: 'Privacy',
    help: 'Help & Support',
    logout: 'Logout',
    continueGoogle: 'Continue with Google',
    continueEmail: 'Continue with Email',
    terms: 'Terms',
    privacyPolicy: 'Privacy',
    loginDesc: 'Connect with unique digital souls in a world beyond imagination.',
    noCreations: 'No creations yet.',
    createNow: 'Create Now',
    checkout: 'Checkout',
    selectPayment: 'Select Payment Method',
    cancel: 'Cancel',
    filters: 'Filters',
    connectNow: 'Connect Now',
    noSoulsFound: 'No souls found',
    tryAdjustingFilters: 'Try adjusting your filters to find more connections.',
    friendsList: 'Friends List',
    recentConversations: 'Recent conversations',
    startChatting: 'Start chatting~',
    noActiveChats: 'No active chats yet',
    findCompanion: 'Find a companion',
    isManifesting: 'is manifesting...',
    simple: 'Simple',
    detailed: 'Detailed',
    import: 'Import',
    next: 'Next',
    back: 'Back',
    createSoul: 'Create Soul',
    basicInfo: 'Basic Info',
    personalitySettings: 'Personality',
    appearance: 'Appearance',
    confirm: 'Confirm',
    step: 'Step',
    gender: 'Gender',
    age: 'Age',
    male: 'Male',
    female: 'Female',
    other: 'Other',
    namePlaceholder: 'Enter name',
    personalityTemplate: 'Personality Template',
    appearanceStyle: 'Appearance Style',
    enhancedMode: 'Enhanced Mode',
    classicMode: 'Classic Mode',
    upgradeToUnlock: 'Upgrade to unlock emotion/memory/growth systems',
    energyCost: 'Energy Cost',
    startCreating: 'Start Creating',
    bio: 'Bio',
    tags: 'Tags',
    occupation: 'Occupation',
    worldview: 'Worldview',
    interests: 'Interests',
    values: 'Values',
    emotionalParams: 'Emotional Parameters',
    behaviorSwitches: 'Behavior Switches',
    allowGrowth: 'Allow Growth',
    proactiveContact: 'Proactive Contact',
    rpMode: 'RP Mode',
    adultContent: 'Adult Content',
    generate: 'Generate',
    regenerate: 'Regenerate',
    uploadPhoto: 'Upload Photo',
    importFile: 'Import File',
    pasteUrl: 'Paste URL',
    selectFile: 'Select File',
    dragAndDrop: 'or drag and drop here',
    parsePreview: 'Parse Preview',
    warning: 'Warning',
    soulAnchorEmpty: 'Soul anchor is empty',
    ageVerification: 'Age Verification',
    ageVerificationDesc: 'This content is intended for adults only. Please confirm you are 18 or older.',
    confirmAge: 'I am 18+',
    personalityHighlights: 'Personality Highlights',
    bringImaginationToLife: 'Bring imagination to life',
    nameLabel: 'Name',
    maxChars: 'Max {n} chars',
    customPersonalityDesc: 'Custom Personality Description',
    overwriteTemplate: 'Overwrite template text...',
    maxInterests: 'Max {n}',
    paidFeature: 'Paid Feature',
    intensity: 'Intensity',
    resilience: 'Resilience',
    expressiveness: 'Expressiveness',
    restraint: 'Restraint',
    music: 'Music',
    reading: 'Reading',
    gaming: 'Gaming',
    cooking: 'Cooking',
    travel: 'Travel',
    art: 'Art',
    coding: 'Coding',
    sports: 'Sports',
    appearanceDesc: 'Appearance Description',
    years: 'Years',
    custom: 'Custom',
    style: 'Style',
    noBio: 'No bio provided.',
    chooseImportMethod: 'Choose Import Method',
    file: 'File',
    url: 'URL',
    text: 'Text',
    appearancePlaceholder: 'Describe their appearance or style keywords...',
    supportFormats: 'Support .png (ST V2) and .json',
    importFromSillyTavern: 'Import from SillyTavern etc.',
    logoutConfirm: 'Are you sure you want to logout?',
    stripePayment: 'Stripe payment initiated...',
    web3Payment: 'Web3 wallet connection initiated...',
    applyFilters: 'Apply Filters',
    startConnection: 'Start Connection',
    luckyGiftBox: 'Lucky Gift Box',
    price: '$4.99',
    soulExplorer: 'Soul Explorer',
    userLevelInfo: 'Level 12 • Digital Nomad',
    friends: 'Friends',
    creations: 'Creations',
    likes: 'Likes',
    energyStatus: 'Energy Status',
    energyDescription: 'Each conversation costs 1 energy, auto-recovers daily. Stay connected to the digital realm.',
    selectConnection: 'Select a connection',
    chooseSoulDescription: 'Choose a soul from the list to continue your journey together.',
    styleDescription: 'Style Description',
    pasteUrlDescription: 'Paste a link from SillyTavern or other character card repositories.',
    unknown: 'Unknown',
    race: 'Race',
  },
  zh: {
    appName: 'clawti',
    tagline: '连接独特的数字灵魂',
    discover: '发现',
    chats: '聊天',
    create: '创建',
    profile: '个人',
    energy: '能量',
    recharge: '充值',
    subscribe: '订阅',
    earn: '赚取',
    personality: '性格',
    rating: '评分',
    typeMessage: '输入消息...',
    outOfEnergy: '能量不足！',
    myCreations: '我的创作',
    accountSettings: '账号设置',
    language: '语言',
    privacy: '隐私',
    help: '帮助与支持',
    logout: '退出登录',
    languageName: '中文',
    continueGoogle: '使用 Google 继续',
    continueEmail: '使用邮箱继续',
    terms: '条款',
    privacyPolicy: '隐私政策',
    loginDesc: '在超越想象的世界中与独特的数字灵魂建立联系。',
    noCreations: '暂无创作。',
    createNow: '立即创建',
    checkout: '结账',
    selectPayment: '选择支付方式',
    cancel: '取消',
    filters: '筛选',
    connectNow: '立即连接',
    noSoulsFound: '未找到灵魂',
    tryAdjustingFilters: '尝试调整筛选条件以查找更多连接。',
    friendsList: '好友列表',
    recentConversations: '最近的对话',
    startChatting: '开始聊天吧~',
    noActiveChats: '暂无活跃聊天',
    findCompanion: '寻找伙伴',
    isManifesting: '正在显现...',
    simple: '简单创建',
    detailed: '详细创建',
    import: '导入角色',
    next: '下一步',
    back: '上一步',
    createSoul: '创造灵魂',
    basicInfo: '基础信息',
    personalitySettings: '性格设置',
    appearance: '外观生成',
    confirm: '确认创建',
    step: '步骤',
    gender: '性别',
    age: '年龄',
    male: '男',
    female: '女',
    other: '其他',
    namePlaceholder: '输入名字',
    personalityTemplate: '选择性格模板',
    appearanceStyle: '选择外观风格',
    enhancedMode: 'Enhanced 模式',
    classicMode: 'Classic 模式',
    upgradeToUnlock: '升级解锁情感/记忆/成长系统',
    energyCost: '能量消耗',
    startCreating: '开始创造',
    bio: '简介',
    tags: '标签',
    occupation: '职业',
    worldview: '世界观',
    interests: '兴趣爱好',
    values: '价值观',
    emotionalParams: '情感参数',
    behaviorSwitches: '行为开关',
    allowGrowth: '允许成长',
    proactiveContact: '主动联系',
    rpMode: 'RP 模式',
    adultContent: '成人内容',
    generate: 'AI 生成',
    regenerate: '重新生成',
    uploadPhoto: '上传照片',
    importFile: '导入文件',
    pasteUrl: '粘贴 URL',
    selectFile: '选择文件',
    dragAndDrop: '或拖拽到此处',
    parsePreview: '解析预览',
    warning: '警告',
    soulAnchorEmpty: '灵魂锚点为空',
    ageVerification: '年龄验证',
    ageVerificationDesc: '此内容仅限成年人。请确认您已年满 18 岁。',
    confirmAge: '我已年满 18 岁',
    personalityHighlights: '性格亮点',
    bringImaginationToLife: '赋予想象力生命',
    nameLabel: '名字',
    maxChars: '最多 {n} 个字符',
    customPersonalityDesc: '自定义性格描述',
    overwriteTemplate: '覆盖模板文本...',
    maxInterests: '最多 {n} 个',
    paidFeature: '付费功能',
    intensity: '情感强度',
    resilience: '韧性',
    expressiveness: '表现力',
    restraint: '克制力',
    music: '音乐',
    reading: '阅读',
    gaming: '游戏',
    cooking: '烹饪',
    travel: '旅行',
    art: '艺术',
    coding: '编程',
    sports: '运动',
    appearanceDesc: '外观描述',
    years: '岁',
    custom: '自定义',
    style: '风格',
    noBio: '暂无简介。',
    chooseImportMethod: '选择导入方式',
    file: '文件',
    url: 'URL',
    text: '文本',
    appearancePlaceholder: '描述他们的外貌或风格关键词...',
    supportFormats: '支持 .png (ST V2) 和 .json',
    importFromSillyTavern: '从 SillyTavern 等导入',
    logoutConfirm: '您确定要退出登录吗？',
    stripePayment: 'Stripe 支付已启动...',
    web3Payment: 'Web3 钱包连接已启动...',
    applyFilters: '应用筛选',
    startConnection: '开始连接',
    luckyGiftBox: '幸运礼盒',
    price: '￥30.00',
    soulExplorer: '灵魂探索者',
    userLevelInfo: '等级 12 • 数字游民',
    friends: '好友',
    creations: '创作',
    likes: '点赞',
    energyStatus: '能量状态',
    energyDescription: '每次对话消耗1点能量，每日自动恢复。保持与数字领域的连接。',
    selectConnection: '选择一个连接',
    chooseSoulDescription: '从列表中选择一个灵魂，继续你们的旅程。',
    styleDescription: '风格描述',
    pasteUrlDescription: '粘贴来自 SillyTavern 或其他角色卡仓库的链接。',
    unknown: '未知',
    race: '种族',
  }
};

const PERSONALITY_TEMPLATES = [
  { id: 'cheerful', name: '开朗活泼', name_en: 'Cheerful', icon: '☀️', desc: '阳光积极，充满活力，总能带给身边的人快乐。', desc_en: 'Sunny and positive, full of energy, always bringing joy to others.', tags: ['热情', '外向', '幽默'] },
  { id: 'gentle', name: '温柔体贴', name_en: 'Gentle', icon: '🌸', desc: '细腻入微，善解人意，像春风般温暖人心。', desc_en: 'Delicate and considerate, understanding, warm like a spring breeze.', tags: ['耐心', '包容', '细心'] },
  { id: 'mysterious', name: '神秘深沉', name_en: 'Mysterious', icon: '🌙', desc: '行踪不定，心思缜密，散发着让人想要探寻的魅力。', desc_en: 'Unpredictable and thoughtful, exuding a charm that makes people want to explore.', tags: ['冷静', '睿智', '内敛'] },
  { id: 'playful', name: '调皮可爱', name_en: 'Playful', icon: '🐱', desc: '古灵精怪，爱开玩笑，总有些出人意料的小点子。', desc_en: 'Quirky and funny, loves to joke, always has unexpected ideas.', tags: ['灵动', '好奇', '活泼'] },
  { id: 'elegant', name: '知性优雅', name_en: 'Elegant', icon: '💎', desc: '举止大方，谈吐不凡，散发着成熟稳重的知性美。', desc_en: 'Graceful and well-spoken, exuding a mature and steady intellectual beauty.', tags: ['端庄', '博学', '自信'] },
  { id: 'healing', name: '慵懒治愈', name_en: 'Healing', icon: '☁️', desc: '随遇而安，慢条斯理，能让人在忙碌中找到宁静。', desc_en: 'Easy-going and slow-paced, helping people find peace in a busy life.', tags: ['随和', '淡然', '治愈'] },
  { id: 'passionate', name: '热血激情', name_en: 'Passionate', icon: '🔥', desc: '志向远大，永不言败，对生活和梦想充满无限动力。', desc_en: 'Ambitious and never-say-die, full of infinite motivation for life and dreams.', tags: ['勇敢', '坚定', '果断'] },
  { id: 'cool', name: '傲娇冷艳', name_en: 'Cool', icon: '❄️', desc: '外冷内热，自尊心强，虽然表面冷漠但内心重情重义。', desc_en: 'Cold outside but warm inside, strong self-esteem, loyal despite a cold exterior.', tags: ['独立', '高冷', '真诚'] },
];

const APPEARANCE_STYLES = [
  { id: 'cute', name: '可爱系', name_en: 'Cute', icon: '🐰', prompt: 'cute, adorable, soft features, expressive eyes' },
  { id: 'cool', name: '酷炫系', name_en: 'Cool', icon: '🦊', prompt: 'cool, stylish, sharp features, modern aesthetic' },
  { id: 'elegant', name: '优雅系', name_en: 'Elegant', icon: '🦢', prompt: 'elegant, sophisticated, graceful, refined' },
  { id: 'fantasy', name: '幻想系', name_en: 'Fantasy', icon: '🦄', prompt: 'fantasy, ethereal, magical, otherworldly' },
];

export default function App() {
  const [language, setLanguage] = useState<'en' | 'zh'>(() => {
    if (typeof window !== 'undefined') {
      const browserLang = navigator.language.split('-')[0];
      return browserLang === 'zh' ? 'zh' : 'en';
    }
    return 'en';
  });
  const t = translations[language];

  const [activeView, setActiveView] = useState<View>('discover');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [characters, setCharacters] = useState<Character[]>(INITIAL_CHARACTERS);
  const [friends, setFriends] = useState<Character[]>([]);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [createFlow, setCreateFlow] = useState<'simple' | 'detailed' | 'import'>('simple');
  const [createStep, setCreateStep] = useState(1);
  const [createForm, setCreateForm] = useState({ 
    name: '', 
    gender: 'Other', 
    age: 18,
    personalityTemplate: '',
    appearanceStyle: '',
    bio: '',
    tags: [] as string[],
    occupation: '',
    world: '',
    personality: '',
    interests: [] as string[],
    values: [] as string[],
    emotion: {
      intensityDial: 50,
      resilience: 50,
      expressiveness: 50,
      restraint: 50
    },
    growth: { enabled: false },
    proactive: { enabled: false },
    rpMode: 'off',
    appearanceDescription: '',
    images: [] as string[]
  });
  const [isPremium, setIsPremium] = useState(false);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [importType, setImportType] = useState<'file' | 'url'>('file');
  const [importUrl, setImportUrl] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [energy, setEnergy] = useState(1000);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ gender: 'All', race: 'All', occupation: 'All' });
  const [discoverIndex, setDiscoverIndex] = useState(0);
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [isFriendsListOpen, setIsFriendsListOpen] = useState(false);
  const [isCharProfileOpen, setIsCharProfileOpen] = useState(false);
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(!!api.getToken());
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [rechargeTab, setRechargeTab] = useState<'subscribe' | 'recharge' | 'earn'>('recharge');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load creatures on mount (works without auth) and validate token if present
  useEffect(() => {
    // Always load discover creatures (endpoint allows unauthenticated access)
    api.creatures.discover({ limit: 50 }).then(res => {
      const discovered = Array.isArray(res) ? res : (res?.creatures || []);
      if (discovered.length > 0) {
        setCharacters(discovered.map(creatureToCharacter));
      }
    }).catch(() => {});

    // Validate existing token
    if (!api.getToken()) return;
    api.auth.me()
      .then(() => {
        setIsLoggedIn(true);
        loadUserData();
      })
      .catch(() => {
        api.setToken(null);
        setIsLoggedIn(false);
      });
  }, []);

  const loadUserData = async () => {
    try {
      const [profileRes, discoverRes, friendsRes] = await Promise.all([
        api.user.profile().catch(() => null),
        api.creatures.discover({ limit: 50 }).catch(() => ({ creatures: [] })),
        api.friends.list().catch(() => ({ friends: [] })),
      ]);
      if (profileRes) {
        setProfileData(profileRes);
        setEnergy(profileRes.energy ?? 1000);
        setIsPremium(profileRes.membershipTier != null && profileRes.membershipTier !== 'free');
      }
      const discovered = (discoverRes?.creatures || discoverRes || []);
      if (Array.isArray(discovered) && discovered.length > 0) {
        setCharacters(discovered.map(creatureToCharacter));
      }
      const friendsList = (friendsRes?.friends || friendsRes || []);
      if (Array.isArray(friendsList)) {
        setFriends(friendsList.map((f: any) => creatureToCharacter(f.creature || f)));
      }
    } catch (err) {
      console.error('Failed to load user data:', err);
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleAuth = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      let res;
      if (authMode === 'register') {
        res = await api.auth.register(authForm.username || authForm.email.split('@')[0], authForm.email, authForm.password);
      } else {
        res = await api.auth.login(authForm.email, authForm.password);
      }
      api.setToken(res.token);
      setIsLoggedIn(true);
      setAuthForm({ username: '', email: '', password: '' });
      loadUserData();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedCharacter || energy <= 0) return;

    const charId = selectedCharacter.id;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText,
      timestamp: Date.now()
    };

    setMessages(prev => ({
      ...prev,
      [charId]: [...(prev[charId] || []), userMsg]
    }));
    setInputText('');
    setIsTyping(true);

    try {
      const result = await api.chat.send(charId, inputText);

      const aiMsg: Message = {
        id: result.reply?.id || (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.reply?.content || "...",
        timestamp: result.reply?.createdAt ? new Date(result.reply.createdAt).getTime() : Date.now()
      };

      setMessages(prev => ({
        ...prev,
        [charId]: [...(prev[charId] || []), aiMsg]
      }));

      if (result.energyRemaining != null) {
        setEnergy(result.energyRemaining);
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setChatError(error instanceof Error ? error.message : 'Failed to send message');
      setTimeout(() => setChatError(null), 5000);
    } finally {
      setIsTyping(false);
    }
  };

  const startChat = async (char: Character) => {
    setSelectedCharacter(char);
    setActiveView('chat');
    if (!messages[char.id]) {
      try {
        const res = await api.chat.messages(char.id);
        const msgs = (res?.messages || res || []).map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
        }));
        if (msgs.length > 0) {
          setMessages(prev => ({ ...prev, [char.id]: msgs }));
        } else {
          setMessages(prev => ({
            ...prev,
            [char.id]: [{
              id: 'greeting',
              role: 'assistant',
              content: char.greeting || `Hello! I'm ${char.name}.`,
              timestamp: Date.now()
            }]
          }));
        }
      } catch {
        setMessages(prev => ({
          ...prev,
          [char.id]: [{
            id: 'greeting',
            role: 'assistant',
            content: char.greeting || `Hello! I'm ${char.name}.`,
            timestamp: Date.now()
          }]
        }));
      }
    }
  };

  const generateField = async (_field: string) => {
    // Field-level AI generation will be moved to backend in a future iteration
    console.log('AI field generation not yet connected to backend');
  };

  // Parse SillyTavern / V2 character card from JSON or PNG
  const handleImportFile = async (file: File) => {
    setImportFile(file);
    try {
      let cardData: any = null;

      if (file.name.endsWith('.json')) {
        const text = await file.text();
        cardData = JSON.parse(text);
      } else if (file.name.endsWith('.png')) {
        // SillyTavern embeds card JSON in PNG tEXt chunk (key: "chara", base64-encoded)
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Search for tEXt chunk with "chara"
        let offset = 8; // skip PNG signature
        while (offset < bytes.length) {
          const len = (bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3];
          const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
          if (type === 'tEXt' || type === 'iTXt') {
            const chunkData = bytes.slice(offset + 8, offset + 8 + len);
            const str = new TextDecoder('latin1').decode(chunkData);
            const nullIdx = str.indexOf('\0');
            const keyword = str.substring(0, nullIdx);
            if (keyword === 'chara') {
              const b64 = str.substring(nullIdx + 1);
              const decoded = atob(b64);
              cardData = JSON.parse(decoded);
              break;
            }
          }
          offset += 12 + len; // 4 len + 4 type + data + 4 CRC
        }
      }

      if (!cardData) {
        setImportPreview({ error: 'Could not parse card data from file' });
        return;
      }

      // Normalize: support V2 (data.name) and V1 (name) formats
      const card = cardData.data || cardData;
      const parsed = {
        name: card.name || card.char_name || '',
        description: card.description || '',
        personality: card.personality || '',
        firstMes: card.first_mes || card.firstMes || card.greeting || '',
        mesExample: card.mes_example || card.mesExample || '',
        scenario: card.scenario || '',
        creatorNotes: card.creator_notes || card.creatorNotes || '',
        tags: card.tags || [],
      };

      setImportPreview(parsed);
      // Pre-fill form
      setCreateForm(prev => ({
        ...prev,
        name: parsed.name,
        bio: parsed.description.slice(0, 500),
        personality: parsed.personality,
        world: parsed.scenario,
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : [],
      }));
      setCreateStep(3);
    } catch (err: any) {
      setImportPreview({ error: err.message || 'Failed to parse file' });
    }
  };

  const handleGenerateCharacter = async () => {
    if (!createForm.name) return;
    setIsGenerating(true);

    try {
      const templatePersonality = PERSONALITY_TEMPLATES.find(t => t.id === createForm.personalityTemplate);

      const createData = {
        name: createForm.name,
        card: {
          personality: createForm.personality || templatePersonality?.desc || '',
          description: importPreview?.description || createForm.bio || '',
          firstMes: importPreview?.firstMes || '',
          mesExample: importPreview?.mesExample || '',
          scenario: importPreview?.scenario || createForm.world || '',
          creatorNotes: importPreview?.creatorNotes || '',
        },
        metadata: {
          gender: createForm.gender,
          age: createForm.age,
          bio: createForm.bio,
          tags: createForm.tags,
          occupation: createForm.occupation,
          worldDescription: createForm.world,
          photos: createForm.images,
          appearanceStyle: createForm.appearanceStyle,
        },
        mode: isPremium ? 'enhanced' : 'classic' as 'classic' | 'enhanced',
      };

      const result = await api.creatures.create(createData);

      const newChar: Character = {
        id: result.agentId || result.agent_id || result.id || Date.now().toString(),
        name: createForm.name,
        tagline: createForm.bio || '',
        description: createForm.world || createForm.bio || '',
        avatar: createForm.images[0] || `https://picsum.photos/seed/${createForm.name}/400/400`,
        images: createForm.images,
        personality: createForm.personality || templatePersonality?.desc || '',
        greeting: '',
        gender: createForm.gender,
        age: createForm.age,
        occupation: createForm.occupation,
        isCustom: true,
      };

      setCharacters(prev => [newChar, ...prev]);

      if (result.energyRemaining != null) {
        setEnergy(result.energyRemaining);
      } else if (result.energy != null) {
        setEnergy(result.energy);
      }

      // Reset form
      setCreateForm({
        name: '',
        gender: 'Other',
        age: 18,
        personalityTemplate: '',
        appearanceStyle: '',
        bio: '',
        tags: [],
        occupation: '',
        world: '',
        personality: '',
        interests: [],
        values: [],
        emotion: { intensityDial: 50, resilience: 50, expressiveness: 50, restraint: 50 },
        growth: { enabled: false },
        proactive: { enabled: false },
        rpMode: 'off',
        appearanceDescription: '',
        images: []
      });
      setCreateStep(1);
      setImportFile(null);
      setImportPreview(null);
      setImportUrl('');
      setActiveView('discover');
    } catch (error) {
      console.error("Creation Error:", error);
      alert(error instanceof Error ? error.message : 'Failed to create creature');
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteCharacter = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCharacters(prev => prev.filter(c => c.id !== id));
    setMessages(prev => {
      const newMsgs = { ...prev };
      delete newMsgs[id];
      return newMsgs;
    });
    if (selectedCharacter?.id === id) setSelectedCharacter(null);
  };

  const activeChats = (() => {
    const charsWithMsgs = characters.filter(c => messages[c.id]);
    const friendsWithMsgs = friends.filter(f => messages[f.id] && !charsWithMsgs.some(c => c.id === f.id));
    return [...charsWithMsgs, ...friendsWithMsgs];
  })();

  const filteredCharacters = characters.filter(char => {
    if (filters.gender !== 'All' && char.gender !== filters.gender) return false;
    if (filters.race !== 'All' && char.race !== filters.race) return false;
    if (filters.occupation !== 'All' && char.occupation !== filters.occupation) return false;
    return true;
  });

  const currentDiscoverChar = filteredCharacters[discoverIndex % filteredCharacters.length];

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (direction === 'right') {
      if (currentDiscoverChar) {
        try {
          await api.friends.add(currentDiscoverChar.id);
          setFriends(prev => [...prev, currentDiscoverChar]);
        } catch (err) {
          console.error('Failed to add friend:', err);
        }
        startChat(currentDiscoverChar);
      }
    }
    setDiscoverIndex(prev => prev + 1);
    setCurrentImageIndex(0);
  };

  const navItems = [
    { id: 'discover', label: t.discover, icon: <Compass className="w-5 h-5 md:w-6 md:h-6" /> },
    { id: 'chat', label: t.chats, icon: <MessageSquare className="w-5 h-5 md:w-6 md:h-6" /> },
    { id: 'create', label: t.create, icon: <PlusCircle className="w-5 h-5 md:w-6 md:h-6" /> },
    { id: 'profile', label: t.profile, icon: <User className="w-5 h-5 md:w-6 md:h-6" /> },
  ];

  return (
    <div className="flex h-screen bg-ramos-white overflow-hidden relative">
      <div className="mesh-bg" />
      
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-72 border-r border-ramos-border bg-white z-40">
        <div className="p-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-ramos-accent rounded-2xl flex items-center justify-center text-white shadow-lg shadow-ramos-accent/30 rotate-3 group cursor-pointer overflow-hidden">
              <div className="relative w-full h-full flex items-center justify-center">
                <Sparkles className="w-6 h-6 absolute transition-transform duration-500 group-hover:scale-150 group-hover:rotate-12" />
                <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <h1 className="text-3xl text-display text-ramos-accent tracking-tight">{t.appName}</h1>
          </div>
        </div>
        
        <nav className="flex-1 px-6 space-y-3">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveView(item.id as View); setSelectedCharacter(null); }}
              className={cn(
                "w-full flex items-center gap-4 px-6 py-4 rounded-[24px] transition-all duration-500 group",
                activeView === item.id 
                  ? "bg-ramos-accent text-white shadow-xl shadow-ramos-accent/20 translate-x-1" 
                  : "text-ramos-muted hover:bg-ramos-gray hover:text-ramos-black"
              )}
            >
              <span className={cn(
                "transition-transform duration-500",
                activeView === item.id ? "scale-110" : "group-hover:scale-110"
              )}>
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-8 border-t border-ramos-border bg-ramos-gray/30">
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.energy}</span>
              <span className="text-xs font-bold text-ramos-accent">{energy}</span>
            </div>
            <div className="w-full h-2 bg-ramos-gray rounded-full overflow-hidden shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (energy / 1000) * 100)}%` }}
                className="h-full bg-ramos-accent shadow-[0_0_10px_rgba(255,92,0,0.3)]"
              />
            </div>
          </div>
        </div>
      </aside>

      {/* Main App Container */}
      <div className="flex-1 flex flex-col relative max-w-md mx-auto md:max-w-none md:mx-0 h-full overflow-hidden border-x border-ramos-border md:border-none bg-ramos-white shadow-2xl md:shadow-none">
        
        {/* Header - Only on Discover (Mobile) */}
        <header className={cn(
          "px-6 py-6 flex items-center justify-end z-20 bg-transparent absolute top-0 left-0 right-0 md:hidden",
          activeView !== 'discover' && "hidden"
        )}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsFilterOpen(true)}
              className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/40 transition-all"
            >
              <Filter className="w-5 h-5" />
            </button>
          </div>
        </header>

      {/* Login Screen */}
      {!isLoggedIn && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-8 text-center"
        >
          <div className="w-24 h-24 bg-ramos-accent rounded-[32px] flex items-center justify-center text-white mb-8 shadow-2xl rotate-3 group cursor-pointer overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <Sparkles className="w-12 h-12 transition-transform duration-700 group-hover:scale-125 group-hover:rotate-12" />
          </div>
          <h1 className="text-4xl text-display mb-2">{t.appName}</h1>
          <p className="text-ramos-muted mb-12 max-w-xs">{t.loginDesc}</p>
          
          <div className="w-full max-w-sm space-y-4">
            {authError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-600 text-center">
                {authError}
              </div>
            )}
            {authMode === 'register' && (
              <input
                type="text"
                value={authForm.username}
                onChange={(e) => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
                placeholder={language === 'en' ? 'Username' : '用户名'}
                className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
              />
            )}
            <input
              type="email"
              value={authForm.email}
              onChange={(e) => setAuthForm(prev => ({ ...prev, email: e.target.value }))}
              placeholder={language === 'en' ? 'Email' : '邮箱'}
              className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
            />
            <input
              type="password"
              value={authForm.password}
              onChange={(e) => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
              placeholder={language === 'en' ? 'Password' : '密码'}
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
            />
            <button
              onClick={handleAuth}
              disabled={authLoading || !authForm.email || !authForm.password}
              className="w-full py-5 bg-black text-white rounded-[24px] font-bold flex items-center justify-center gap-3 hover:bg-black/90 transition-all disabled:opacity-50"
            >
              {authLoading ? (language === 'en' ? 'Loading...' : '加载中...') : (authMode === 'login' ? (language === 'en' ? 'Log In' : '登录') : (language === 'en' ? 'Register' : '注册'))}
            </button>
            <button
              onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
              className="w-full py-5 bg-ramos-gray text-black rounded-[24px] font-bold flex items-center justify-center gap-3 hover:bg-ramos-border transition-all"
            >
              {authMode === 'login' ? (language === 'en' ? 'Create Account' : '创建账号') : (language === 'en' ? 'Already have an account? Log In' : '已有账号？登录')}
            </button>
          </div>
          
          <p className="mt-12 text-[10px] text-ramos-muted uppercase tracking-widest">
            By continuing, you agree to our <span className="text-black font-bold">{t.terms}</span> & <span className="text-black font-bold">{t.privacyPolicy}</span>
          </p>
        </motion.div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeView === 'discover' && (
            <motion.div
              key="discover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="h-full relative overflow-y-auto md:p-12"
            >
              {/* Desktop Header */}
              <div className="hidden md:flex items-center justify-between mb-12">
                <div>
                  <h2 className="text-5xl text-display mb-2">{t.discover}</h2>
                  <p className="text-ramos-muted text-sm font-accent tracking-widest uppercase">{t.tagline}</p>
                </div>
                <button 
                  onClick={() => setIsFilterOpen(true)}
                  className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white border border-ramos-border text-ramos-black hover:bg-ramos-gray transition-all shadow-sm font-bold text-xs uppercase tracking-widest"
                >
                  <Filter className="w-4 h-4" />
                  {t.filters}
                </button>
              </div>

              {/* Full Screen Image Discover (Mobile) / Grid (Desktop) */}
              <div className="md:grid md:grid-cols-2 lg:grid-cols-3 gap-8 h-full md:h-auto">
                {filteredCharacters.length > 0 ? (
                  <>
                    {/* Mobile View (Single Card Swipe) */}
                    <div className="md:hidden h-full w-full relative overflow-hidden">
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={currentDiscoverChar.id}
                      drag="x"
                      dragConstraints={{ left: 0, right: 0 }}
                      onDragEnd={(_, info) => {
                        if (info.offset.x > 100) handleSwipe('right');
                        else if (info.offset.x < -100) handleSwipe('left');
                      }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ 
                        opacity: 0, 
                        x: 500,
                        transition: { duration: 0.3 } 
                      }}
                      className="h-full w-full absolute inset-0 touch-none"
                    >
                      <div className="relative h-full w-full" onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const images = currentDiscoverChar.images || [currentDiscoverChar.avatar];
                        if (x < rect.width / 3) {
                          setCurrentImageIndex(prev => (prev > 0 ? prev - 1 : images.length - 1));
                        } else if (x > (rect.width * 2) / 3) {
                          setCurrentImageIndex(prev => (prev < images.length - 1 ? prev + 1 : 0));
                        } else {
                          setIsCharProfileOpen(true);
                        }
                      }}>
                        <img 
                          src={(currentDiscoverChar.images || [currentDiscoverChar.avatar])[currentImageIndex]} 
                          alt={currentDiscoverChar.name}
                          className="w-full h-full object-cover pointer-events-none"
                          referrerPolicy="no-referrer"
                        />
                        
                        {/* Image Indicators */}
                        <div className="absolute top-6 left-0 right-0 flex justify-center gap-1.5 px-8 z-10">
                          {(currentDiscoverChar.images || [currentDiscoverChar.avatar]).map((_, idx) => (
                            <div 
                              key={idx} 
                              className={cn(
                                "h-1 flex-1 rounded-full transition-all duration-300",
                                idx === currentImageIndex ? "bg-white" : "bg-white/30"
                              )}
                            />
                          ))}
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-95 pointer-events-none" />
                        
                        <div className="absolute bottom-20 md:bottom-6 left-0 right-0 p-6 space-y-3 pointer-events-none">
                          <div className="flex flex-wrap gap-1.5 mb-1">
                            {currentDiscoverChar.occupation && (
                              <div className="flex items-center gap-1 bg-white/10 backdrop-blur-md px-2.5 py-0.5 rounded-full border border-white/10">
                                <span className="text-[9px] font-extrabold font-accent text-white uppercase tracking-wider">{language === 'en' ? currentDiscoverChar.occupation_en || currentDiscoverChar.occupation : currentDiscoverChar.occupation}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1 bg-ramos-accent/80 backdrop-blur-md px-2.5 py-0.5 rounded-full border border-white/10">
                              <Sparkles className="w-2.5 h-2.5 text-white fill-current" />
                              <span className="text-[9px] font-extrabold font-accent text-white">{currentDiscoverChar.rating || '4.8'}</span>
                            </div>
                          </div>

                          <div className="flex items-end justify-between">
                            <div>
                              <h2 className="text-4xl text-display text-white text-dense mb-0.5">{currentDiscoverChar.name}</h2>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex flex-wrap gap-1.5">
                              {(language === 'en' ? currentDiscoverChar.personality_en || currentDiscoverChar.personality : currentDiscoverChar.personality).split(',').slice(0, 3).map((trait, i) => (
                                <span key={i} className="px-2 py-0.5 bg-white/5 backdrop-blur-md rounded-full text-[9px] font-bold text-white/80 border border-white/5 uppercase tracking-wider">
                                  {trait.trim()}
                                </span>
                              ))}
                            </div>
                          </div>

                          <p className="text-xs text-white/70 font-medium leading-snug line-clamp-2 max-w-[90%]">{language === 'en' ? currentDiscoverChar.description_en || currentDiscoverChar.description : currentDiscoverChar.description}</p>
                          
                          <div className="flex items-center justify-center gap-6 pt-2 pb-4 pointer-events-auto">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleSwipe('left'); }}
                              className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-all"
                            >
                              <X className="w-6 h-6" />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleSwipe('right'); }}
                              className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-ramos-accent hover:bg-ramos-accent hover:text-white transition-all shadow-lg"
                            >
                              <Heart className="w-6 h-6 fill-current" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Desktop View (Grid) */}
                    {filteredCharacters.map((char) => (
                      <motion.div
                        key={char.id}
                        whileHover={{ y: -10 }}
                        className="hidden md:block group relative aspect-[3/4] rounded-[40px] overflow-hidden cursor-pointer shadow-2xl"
                        onClick={() => startChat(char)}
                      >
                        <img 
                          src={char.avatar} 
                          alt={char.name}
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
                        
                        <div className="absolute bottom-0 left-0 right-0 p-8 space-y-4">
                          <div className="flex flex-wrap gap-2">
                            <div className="flex items-center gap-1.5 bg-ramos-accent/90 px-3 py-1 rounded-full">
                              <Sparkles className="w-3 h-3 text-white fill-current" />
                              <span className="text-[10px] font-bold font-accent text-white">{char.rating || '4.8'}</span>
                            </div>
                            {char.occupation && (
                              <div className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full">
                                <span className="text-[10px] font-bold font-accent text-white uppercase tracking-wider">{language === 'en' ? char.occupation_en || char.occupation : char.occupation}</span>
                              </div>
                            )}
                          </div>
                          <h3 className="text-4xl text-display text-white">{char.name}</h3>
                          <p className="text-sm text-white/70 line-clamp-2 font-medium">{language === 'en' ? char.description_en || char.description : char.description}</p>
                          <div className="pt-4 opacity-0 group-hover:opacity-100 transition-opacity translate-y-4 group-hover:translate-y-0 duration-500">
                            <button className="w-full py-4 bg-white text-black rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl">
                              {t.connectNow}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </>
                ) : (
                  <div className="col-span-full h-full flex flex-col items-center justify-center text-ramos-muted gap-6 opacity-30 p-12 text-center">
                    <div className="w-32 h-32 rounded-[48px] bg-ramos-gray flex items-center justify-center mb-4">
                      <Compass className="w-16 h-16" />
                    </div>
                    <h3 className="text-2xl text-display">{t.noSoulsFound}</h3>
                    <p className="max-w-xs text-sm font-medium">{t.tryAdjustingFilters}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeView === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="h-full flex flex-row overflow-hidden bg-ramos-gray/30"
            >
              {/* Desktop Chat List Sidebar */}
              <div className={cn(
                "w-full md:w-80 flex-col border-r border-ramos-border bg-white/50 backdrop-blur-xl md:flex",
                selectedCharacter ? "hidden" : "flex"
              )}>
                <div className="pt-6 px-6 pb-32 flex-1 flex flex-col overflow-y-auto">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-3xl text-display mb-1">{t.chats}</h2>
                      <p className="text-ramos-muted text-[10px] font-medium uppercase tracking-wider">{t.recentConversations}</p>
                    </div>
                    <button 
                      onClick={() => setIsFriendsListOpen(true)}
                      className="p-3 rounded-2xl bg-white border border-ramos-border text-ramos-black hover:bg-ramos-gray transition-all shadow-sm"
                    >
                      <Users className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="flex-1 space-y-4">
                    {activeChats.length > 0 ? (
                      activeChats.map(char => {
                        const charMsgs = messages[char.id] || [];
                        const lastMsg = charMsgs[charMsgs.length - 1];
                        return (
                          <motion.div 
                            key={char.id}
                            whileHover={{ x: 5 }}
                            onClick={() => setSelectedCharacter(char)}
                            className={cn(
                              "cursor-pointer flex items-center gap-4 hover:bg-ramos-gray transition-all p-4 rounded-[32px] border border-ramos-border bg-white mb-4 shadow-sm",
                              selectedCharacter?.id === char.id && "bg-ramos-accent/5 border-ramos-accent/20 ring-2 ring-ramos-accent/10"
                            )}
                          >
                            <div className="relative shrink-0">
                              <img 
                                src={char.avatar} 
                                alt={char.name}
                                className="w-16 h-16 rounded-[24px] object-cover border border-ramos-border"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-ramos-accent border-2 border-white rounded-full" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <h3 className="text-2xl text-display truncate max-w-[120px]">{char.name}</h3>
                                <span className="text-[10px] font-accent text-ramos-muted">
                                  {lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
                                </span>
                              </div>
                              <p className="text-xs text-ramos-muted truncate font-medium">
                                {lastMsg ? lastMsg.content : t.startChatting}
                              </p>
                            </div>
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-ramos-muted gap-8 opacity-40">
                        <div className="w-24 h-24 rounded-[40px] bg-ramos-gray flex items-center justify-center">
                          <MessageSquare className="w-12 h-12" />
                        </div>
                        <p className="text-lg font-medium">{t.noActiveChats}</p>
                        <button 
                          onClick={() => setActiveView('discover')}
                          className="text-ramos-accent text-sm text-accent underline underline-offset-8"
                        >
                          {t.findCompanion}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Chat Window */}
              <div className={cn(
                "flex-1 flex-col h-full bg-white md:flex relative",
                selectedCharacter ? "flex" : "hidden"
              )}>
                {selectedCharacter ? (
                  <div className="h-full flex flex-col relative z-10">
                    {/* Chat Background with Overlay */}
                    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                      <img 
                        src="https://picsum.photos/seed/user/400/400" 
                        alt="" 
                        className="w-full h-full object-cover blur-sm opacity-30"
                      />
                      <div className="absolute inset-0 bg-black/50" />
                    </div>

                    {/* Chat Header */}
                    <div className="px-6 py-8 border-b border-white/10 flex items-center gap-6 bg-black/30 backdrop-blur-2xl sticky top-0 z-20 text-white">
                      <button onClick={() => setSelectedCharacter(null)} className="md:hidden p-3 -ml-2 rounded-2xl hover:bg-white/10 transition-colors">
                        <ArrowLeft className="w-7 h-7" />
                      </button>
                      <div className="flex items-center gap-5 cursor-pointer" onClick={() => setIsCharProfileOpen(true)}>
                        <div className="relative">
                          <img 
                            src={selectedCharacter.avatar} 
                            alt={selectedCharacter.name}
                            className="w-14 h-14 rounded-full object-cover border-2 border-ramos-accent/60 shadow-[0_0_15px_rgba(255,92,0,0.3)]"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div>
                          <h3 className="text-2xl text-display leading-none">{selectedCharacter.name}</h3>
                        </div>
                      </div>
                      
                      <div className="ml-auto flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                          <Sparkles className="w-4 h-4 text-ramos-accent fill-current" />
                          <span className="text-sm font-bold font-accent">{energy}</span>
                        </div>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-8 space-y-10 scroll-smooth pb-40 relative z-10">
                      {(messages[selectedCharacter.id] || []).map((msg) => (
                        <motion.div 
                          key={msg.id}
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className={cn(
                            "flex flex-col max-w-[85%] md:max-w-[70%]",
                            msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                          )}
                        >
                          <div className={cn(
                            "px-6 py-5 rounded-[28px] text-base font-medium leading-relaxed shadow-sm",
                            msg.role === 'user' 
                              ? "bg-ramos-accent text-white rounded-tr-none shadow-[0_15px_30px_rgba(255,92,0,0.15)]" 
                              : "bg-white text-ramos-black rounded-tl-none border border-ramos-border"
                          )}>
                            <div className={cn(
                              "markdown-body prose prose-sm max-w-none",
                              msg.role === 'user' ? "prose-invert" : ""
                            )}>
                              <ReactMarkdown>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                          <span className="text-[10px] font-accent text-ramos-muted mt-3 px-2 uppercase tracking-widest">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </motion.div>
                      ))}
                      {isTyping && (
                        <div className="flex items-center gap-4 text-ramos-muted text-[11px] text-accent">
                          <div className="flex gap-2">
                            <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-ramos-accent rounded-full" />
                            <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-ramos-accent rounded-full" />
                            <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-ramos-accent rounded-full" />
                          </div>
                          {selectedCharacter.name} {t.isManifesting}
                        </div>
                      )}
                      {chatError && (
                        <div className="mx-4 mb-2 p-3 bg-red-500/20 border border-red-500/40 rounded-2xl text-red-300 text-xs text-center animate-in fade-in">
                          {chatError}
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="fixed bottom-12 left-0 right-0 max-w-md mx-auto px-6 z-30 md:relative md:bottom-0 md:max-w-none md:pb-12 md:pt-4 bg-transparent">
                      <div className="relative flex items-center bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[40px] p-2 shadow-2xl">
                        <button className="p-3 text-white/60 hover:text-white transition-colors">
                          <Mic className="w-5 h-5" />
                        </button>
                        <input 
                          type="text" 
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                          placeholder={energy > 0 ? t.typeMessage : t.outOfEnergy}
                          disabled={energy <= 0}
                          className="flex-1 bg-transparent border-none py-4 px-3 text-sm focus:outline-none disabled:opacity-50 font-medium text-white placeholder:text-white/30"
                        />
                        <div className="flex items-center gap-1 pr-1">
                          <button className="p-3 text-white/60 hover:text-white transition-colors">
                            <Gift className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={handleSendMessage}
                            disabled={!inputText.trim() || isTyping || energy <= 0}
                            className="p-3 text-white/60 hover:text-white disabled:opacity-30 transition-all"
                          >
                            <Send className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-ramos-muted gap-6 opacity-30 p-12 text-center">
                    <div className="w-32 h-32 rounded-[48px] bg-ramos-gray flex items-center justify-center mb-4">
                      <MessageSquare className="w-16 h-16" />
                    </div>
                    <h3 className="text-2xl text-display">{t.selectConnection}</h3>
                    <p className="max-w-xs text-sm font-medium">{t.chooseSoulDescription}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeView === 'create' && (
            <motion.div
              key="create"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
              className="space-y-8 pt-6 px-6 pb-32 overflow-y-auto h-full max-w-4xl mx-auto w-full"
            >
              {/* Header */}
              <div className="space-y-6 mb-8">
                <div>
                  <h2 className="text-4xl text-display mb-1">{t.create}</h2>
                  <p className="text-ramos-muted text-[10px] font-medium uppercase tracking-wider">{t.bringImaginationToLife}</p>
                </div>
                <div className="flex bg-ramos-gray p-1 rounded-2xl border border-ramos-border w-fit">
                  {(['simple', 'detailed', 'import'] as const).map((flow) => (
                    <button
                      key={flow}
                      onClick={() => { setCreateFlow(flow); setCreateStep(1); }}
                      className={cn(
                        "px-6 py-2 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all",
                        createFlow === flow ? "bg-white text-ramos-accent shadow-sm" : "text-ramos-muted hover:text-ramos-black"
                      )}
                    >
                      {t[flow]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress Bar */}
              {createFlow !== 'simple' && (
                <div className="flex items-center gap-2 mb-12">
                  {Array.from({ length: createFlow === 'detailed' ? 6 : 5 }).map((_, i) => (
                    <div 
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-all duration-500",
                        i + 1 <= createStep ? "bg-ramos-accent shadow-[0_0_10px_rgba(255,92,0,0.3)]" : "bg-ramos-gray"
                      )}
                    />
                  ))}
                </div>
              )}

              {/* Flow Content */}
              <div className="min-h-[400px]">
                {/* SIMPLE FLOW */}
                {createFlow === 'simple' && (
                  <div className="space-y-12">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-10">
                      {/* Basic Info */}
                      <section className="space-y-6">
                        <h3 className="text-2xl text-display">{t.basicInfo}</h3>
                        <div className="space-y-4">
                          <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.nameLabel}</label>
                          <input 
                            type="text" 
                            value={createForm.name}
                            onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder={t.namePlaceholder}
                            className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.gender}</label>
                            <div className="flex bg-ramos-gray p-1 rounded-2xl border border-ramos-border">
                              {([t.female, t.male, t.other] as const).map((g) => (
                                <button
                                  key={g}
                                  onClick={() => setCreateForm(prev => ({ ...prev, gender: g }))}
                                  className={cn(
                                    "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all",
                                    createForm.gender === g ? "bg-white text-ramos-accent shadow-sm" : "text-ramos-muted hover:text-ramos-black"
                                  )}
                                >
                                  {g}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.age}</label>
                            <input 
                              type="number" 
                              min="1" 
                              max="120" 
                              value={createForm.age}
                              onChange={(e) => setCreateForm(prev => ({ ...prev, age: parseInt(e.target.value) || 0 }))}
                              className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
                            />
                          </div>
                        </div>
                      </section>

                      {/* Personality */}
                      <section className="space-y-6">
                        <h3 className="text-2xl text-display">{t.personalityTemplate}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {PERSONALITY_TEMPLATES.map((tmpl) => (
                            <button
                              key={tmpl.id}
                              onClick={() => setCreateForm(prev => ({ ...prev, personalityTemplate: tmpl.id }))}
                              className={cn(
                                "p-4 rounded-[32px] border-2 transition-all text-left flex flex-col gap-3 group",
                                createForm.personalityTemplate === tmpl.id 
                                  ? "bg-ramos-accent/5 border-ramos-accent shadow-lg shadow-ramos-accent/10" 
                                  : "bg-white border-ramos-border hover:border-ramos-accent/30"
                              )}
                            >
                              <span className="text-3xl">{tmpl.icon}</span>
                              <div>
                                <h4 className={cn("font-bold text-sm mb-1", createForm.personalityTemplate === tmpl.id ? "text-ramos-accent" : "text-ramos-black")}>
                                  {language === 'en' ? tmpl.name_en : tmpl.name}
                                </h4>
                                <p className="text-[9px] text-ramos-muted leading-tight line-clamp-2">
                                  {language === 'en' ? tmpl.desc_en : tmpl.desc}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                        {createForm.personalityTemplate && (
                          <div className="p-6 bg-ramos-accent/5 rounded-[24px] border border-ramos-accent/20">
                            <p className="text-[10px] text-accent text-ramos-accent uppercase tracking-widest font-bold mb-3">{t.personalityHighlights}</p>
                            <div className="flex flex-wrap gap-2">
                              {PERSONALITY_TEMPLATES.find(t => t.id === createForm.personalityTemplate)?.tags.map(tag => (
                                <span key={tag} className="px-3 py-1 bg-white rounded-full text-[10px] font-bold text-ramos-accent border border-ramos-accent/20">#{tag}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>

                      {/* Appearance */}
                      <section className="space-y-6">
                        <h3 className="text-2xl text-display">{t.appearanceStyle}</h3>
                        <div className="grid grid-cols-2 gap-4">
                          {APPEARANCE_STYLES.map((style) => (
                            <button
                              key={style.id}
                              onClick={() => setCreateForm(prev => ({ ...prev, appearanceStyle: style.id }))}
                              className={cn(
                                "p-6 rounded-[32px] border-2 transition-all flex items-center gap-4",
                                createForm.appearanceStyle === style.id 
                                  ? "bg-ramos-accent/5 border-ramos-accent shadow-lg" 
                                  : "bg-white border-ramos-border hover:border-ramos-accent/30"
                              )}
                            >
                              <span className="text-4xl">{style.icon}</span>
                              <span className="font-bold text-lg">{language === 'en' ? style.name_en : style.name}</span>
                            </button>
                          ))}
                        </div>
                        <div className="space-y-4 pt-4">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.styleDescription}</label>
                            <button 
                              onClick={() => generateField('appearanceDescription')}
                              className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest flex items-center gap-1"
                            >
                              <Sparkles className="w-3 h-3" />
                              {t.generate}
                            </button>
                          </div>
                          <textarea 
                            value={createForm.appearanceDescription}
                            onChange={(e) => setCreateForm(prev => ({ ...prev, appearanceDescription: e.target.value }))}
                            placeholder={t.appearancePlaceholder}
                            rows={4}
                            className="w-full bg-ramos-gray border border-ramos-border rounded-[32px] p-6 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all resize-none font-medium"
                          />
                        </div>
                      </section>

                      {/* Mode & Cost */}
                      <section className="space-y-6">
                        <div className="bento-card p-8">
                          <div className="flex items-center justify-center md:justify-start gap-2">
                            {isPremium ? (
                              <div className="flex items-center gap-1.5 text-ramos-accent bg-ramos-accent/10 px-3 py-1 rounded-full">
                                <Sparkles className="w-3 h-3 fill-current" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">{t.enhancedMode} ✨</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center md:items-start gap-1">
                                <div className="flex items-center gap-1.5 text-ramos-muted bg-ramos-gray px-3 py-1 rounded-full">
                                  <span className="text-[10px] font-bold uppercase tracking-widest">{t.classicMode}</span>
                                </div>
                                <p className="text-[8px] text-ramos-muted italic">{t.upgradeToUnlock}</p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-6 bg-ramos-gray rounded-[24px]">
                          <span className="text-xs font-bold text-ramos-muted uppercase tracking-widest">{t.energyCost}</span>
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-ramos-accent fill-current" />
                            <span className="text-xl font-bold text-ramos-accent">100</span>
                          </div>
                        </div>
                      </section>
                    </motion.div>
                  </div>
                )}

                {/* DETAILED FLOW */}
                {createFlow === 'detailed' && (
                  <div className="space-y-8">
                    {createStep === 1 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                        <h3 className="text-2xl text-display">{t.basicInfo}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.nameLabel}</label>
                            <input type="text" value={createForm.name} onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t.namePlaceholder} className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium" />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-4">
                              <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.gender}</label>
                              <div className="flex bg-ramos-gray p-1 rounded-2xl border border-ramos-border">
                                {([t.female, t.male, t.other] as const).map((g) => (
                                  <button key={g} onClick={() => setCreateForm(prev => ({ ...prev, gender: g }))} className={cn("flex-1 py-3 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all", createForm.gender === g ? "bg-white text-ramos-accent shadow-sm" : "text-ramos-muted hover:text-ramos-black")}>{g}</button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-4">
                              <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.age}</label>
                              <input 
                                type="number" 
                                min="1" 
                                max="120" 
                                value={createForm.age}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, age: parseInt(e.target.value) || 0 }))}
                                className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] py-4 px-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.bio} ({t.maxChars.replace('{n}', '100')})</label>
                            <button onClick={() => generateField('bio')} className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest flex items-center gap-1"><Sparkles className="w-3 h-3" />{t.generate}</button>
                          </div>
                          <textarea maxLength={100} value={createForm.bio} onChange={(e) => setCreateForm(prev => ({ ...prev, bio: e.target.value }))} className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all resize-none font-medium" rows={3} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.occupation}</label>
                              <button onClick={() => generateField('occupation')} className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest flex items-center gap-1"><Sparkles className="w-3 h-3" />{t.generate}</button>
                            </div>
                            <input type="text" value={createForm.occupation} onChange={(e) => setCreateForm(prev => ({ ...prev, occupation: e.target.value }))} className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium" />
                          </div>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.worldview}</label>
                              <button onClick={() => generateField('world')} className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest flex items-center gap-1"><Sparkles className="w-3 h-3" />{t.generate}</button>
                            </div>
                            <input type="text" value={createForm.world} onChange={(e) => setCreateForm(prev => ({ ...prev, world: e.target.value }))} className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium" />
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {createStep === 2 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.personalitySettings}</h3>
                        <div className="space-y-4">
                          <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.personalityTemplate}</label>
                          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                            {PERSONALITY_TEMPLATES.map((tmpl) => (
                              <button
                                key={tmpl.id}
                                onClick={() => setCreateForm(prev => ({ ...prev, personalityTemplate: tmpl.id }))}
                                title={language === 'en' ? tmpl.name_en : tmpl.name}
                                className={cn(
                                  "aspect-square rounded-2xl border-2 transition-all flex items-center justify-center text-xl",
                                  createForm.personalityTemplate === tmpl.id ? "bg-ramos-accent/10 border-ramos-accent" : "bg-white border-ramos-border hover:border-ramos-accent/30"
                                )}
                              >
                                {tmpl.icon}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-4">
                          <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.customPersonalityDesc}</label>
                          <textarea value={createForm.personality} onChange={(e) => setCreateForm(prev => ({ ...prev, personality: e.target.value }))} className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all resize-none font-medium" rows={4} placeholder={t.overwriteTemplate} />
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.interests} ({t.maxInterests.replace('{n}', '6')})</label>
                            <button onClick={() => generateField('interests')} className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest flex items-center gap-1"><Sparkles className="w-3 h-3" />{t.generate}</button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { label: t.music, value: 'Music' },
                              { label: t.reading, value: 'Reading' },
                              { label: t.gaming, value: 'Gaming' },
                              { label: t.cooking, value: 'Cooking' },
                              { label: t.travel, value: 'Travel' },
                              { label: t.art, value: 'Art' },
                              { label: t.coding, value: 'Coding' },
                              { label: t.sports, value: 'Sports' }
                            ].map(interest => (
                              <button
                                key={interest.value}
                                onClick={() => {
                                  setCreateForm(prev => {
                                    const interests = prev.interests.includes(interest.value) 
                                      ? prev.interests.filter(i => i !== interest.value)
                                      : prev.interests.length < 6 ? [...prev.interests, interest.value] : prev.interests;
                                    return { ...prev, interests };
                                  });
                                }}
                                className={cn(
                                  "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border",
                                  createForm.interests.includes(interest.value) ? "bg-ramos-accent text-white border-ramos-accent" : "bg-white text-ramos-muted border-ramos-border hover:border-ramos-accent/30"
                                )}
                              >
                                {interest.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {createStep === 3 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <div className="flex items-center justify-between">
                          <h3 className="text-2xl text-display">{t.emotionalParams}</h3>
                          {!isPremium && <span className="px-3 py-1 bg-ramos-gray rounded-full text-[8px] font-bold uppercase tracking-widest text-ramos-muted">🔒 {t.paidFeature}</span>}
                        </div>
                        <div className={cn("space-y-8", !isPremium && "opacity-50 pointer-events-none grayscale")}>
                          {[
                            { label: t.intensity, key: 'intensityDial' },
                            { label: t.resilience, key: 'resilience' },
                            { label: t.expressiveness, key: 'expressiveness' },
                            { label: t.restraint, key: 'restraint' }
                          ].map(param => (
                            <div key={param.key} className="space-y-4">
                              <div className="flex justify-between">
                                <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{param.label}</label>
                                <span className="text-xs font-bold text-ramos-accent">{createForm.emotion[param.key as keyof typeof createForm.emotion]}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                value={createForm.emotion[param.key as keyof typeof createForm.emotion]}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, emotion: { ...prev.emotion, [param.key]: parseInt(e.target.value) } }))}
                                className="w-full accent-ramos-accent"
                              />
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}

                    {createStep === 4 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <div className="flex items-center justify-between">
                          <h3 className="text-2xl text-display">{t.behaviorSwitches}</h3>
                          {!isPremium && <span className="px-3 py-1 bg-ramos-gray rounded-full text-[8px] font-bold uppercase tracking-widest text-ramos-muted">🔒 {t.paidFeature}</span>}
                        </div>
                        <div className={cn("space-y-6", !isPremium && "opacity-50 pointer-events-none grayscale")}>
                          <div className="flex items-center justify-between p-6 bg-ramos-gray rounded-[24px]">
                            <div>
                              <p className="font-bold text-sm">{t.allowGrowth}</p>
                              <p className="text-[10px] text-ramos-muted">{language === 'en' ? 'Character learns and evolves over time' : '角色会随着时间学习和进化'}</p>
                            </div>
                            <button 
                              onClick={() => setCreateForm(prev => ({ ...prev, growth: { enabled: !prev.growth.enabled } }))}
                              className={cn("w-12 h-6 rounded-full transition-all relative", createForm.growth.enabled ? "bg-ramos-accent" : "bg-ramos-border")}
                            >
                              <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", createForm.growth.enabled ? "left-7" : "left-1")} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between p-6 bg-ramos-gray rounded-[24px]">
                            <div>
                              <p className="font-bold text-sm">{t.proactiveContact}</p>
                              <p className="text-[10px] text-ramos-muted">{language === 'en' ? 'Character can initiate conversations' : '角色可以主动发起对话'}</p>
                            </div>
                            <button 
                              onClick={() => setCreateForm(prev => ({ ...prev, proactive: { enabled: !prev.proactive.enabled } }))}
                              className={cn("w-12 h-6 rounded-full transition-all relative", createForm.proactive.enabled ? "bg-ramos-accent" : "bg-ramos-border")}
                            >
                              <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", createForm.proactive.enabled ? "left-7" : "left-1")} />
                            </button>
                          </div>
                          <div className="space-y-4">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.rpMode}</label>
                            <div className="flex bg-ramos-gray p-1 rounded-2xl border border-ramos-border">
                              {(['off', 'sfw', 'nsfw'] as const).map((mode) => (
                                <button
                                  key={mode}
                                  onClick={() => {
                                    if (mode === 'nsfw') setShowAgeVerification(true);
                                    setCreateForm(prev => ({ ...prev, rpMode: mode }));
                                  }}
                                  className={cn(
                                    "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1",
                                    createForm.rpMode === mode ? "bg-white text-ramos-accent shadow-sm" : "text-ramos-muted hover:text-ramos-black"
                                  )}
                                >
                                  {mode === 'nsfw' && <Shield className="w-3 h-3" />}
                                  {mode.toUpperCase()}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {createStep === 5 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.appearance}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {APPEARANCE_STYLES.map((style) => (
                            <button
                              key={style.id}
                              onClick={() => setCreateForm(prev => ({ ...prev, appearanceStyle: style.id }))}
                              className={cn(
                                "p-4 rounded-[32px] border-2 transition-all flex flex-col items-center gap-2",
                                createForm.appearanceStyle === style.id ? "bg-ramos-accent/5 border-ramos-accent" : "bg-white border-ramos-border hover:border-ramos-accent/30"
                              )}
                            >
                              <span className="text-3xl">{style.icon}</span>
                              <span className="font-bold text-[10px] uppercase tracking-widest">{style.name}</span>
                            </button>
                          ))}
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.appearanceDesc}</label>
                            <button onClick={() => generateField('appearanceDescription')} className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest flex items-center gap-1"><Sparkles className="w-3 h-3" />{t.generate}</button>
                          </div>
                          <textarea value={createForm.appearanceDescription} onChange={(e) => setCreateForm(prev => ({ ...prev, appearanceDescription: e.target.value }))} className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all resize-none font-medium" rows={3} />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {[1, 2, 3].map(i => (
                            <div key={i} className="aspect-square rounded-3xl bg-ramos-gray border border-ramos-border flex items-center justify-center overflow-hidden relative group">
                              {createForm.images[i-1] ? (
                                <img src={createForm.images[i-1]} className="w-full h-full object-cover" />
                              ) : (
                                <PlusCircle className="w-6 h-6 text-ramos-muted opacity-30" />
                              )}
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <button className="p-2 bg-white rounded-full text-ramos-black shadow-lg"><RefreshCw className="w-4 h-4" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <button className="w-full py-4 bg-ramos-gray border border-ramos-border rounded-[24px] text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-ramos-border transition-all">
                          <FileUp className="w-4 h-4" />
                          {t.uploadPhoto}
                        </button>
                      </motion.div>
                    )}

                    {createStep === 6 && (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.confirm}</h3>
                        <div className="bento-card p-8 space-y-6">
                          <div className="flex items-center gap-6">
                            <img src={`https://picsum.photos/seed/${createForm.name}/400/400`} className="w-24 h-24 rounded-[32px] object-cover border-2 border-ramos-accent shadow-lg" />
                            <div>
                              <h4 className="text-3xl text-display">{createForm.name}</h4>
                              <p className="text-xs text-ramos-muted font-medium">{createForm.occupation} • {createForm.age} {t.years}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-ramos-gray rounded-2xl">
                              <p className="text-[8px] text-ramos-muted uppercase tracking-widest font-bold mb-1">{t.personality}</p>
                              <p className="text-xs font-bold">{language === 'en' ? PERSONALITY_TEMPLATES.find(t => t.id === createForm.personalityTemplate)?.name_en || PERSONALITY_TEMPLATES.find(t => t.id === createForm.personalityTemplate)?.name : PERSONALITY_TEMPLATES.find(t => t.id === createForm.personalityTemplate)?.name || t.custom}</p>
                            </div>
                            <div className="p-4 bg-ramos-gray rounded-2xl">
                              <p className="text-[8px] text-ramos-muted uppercase tracking-widest font-bold mb-1">{t.style}</p>
                              <p className="text-xs font-bold">{language === 'en' ? APPEARANCE_STYLES.find(t => t.id === createForm.appearanceStyle)?.name_en || APPEARANCE_STYLES.find(t => t.id === createForm.appearanceStyle)?.name : APPEARANCE_STYLES.find(t => t.id === createForm.appearanceStyle)?.name || t.custom}</p>
                            </div>
                          </div>
                          <div className="p-4 bg-ramos-gray rounded-2xl">
                            <p className="text-[8px] text-ramos-muted uppercase tracking-widest font-bold mb-1">{t.bio}</p>
                            <p className="text-xs leading-relaxed">{createForm.bio || t.noBio}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-6 bg-ramos-gray rounded-[24px]">
                          <span className="text-xs font-bold text-ramos-muted uppercase tracking-widest">{t.energyCost}</span>
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-ramos-accent fill-current" />
                            <span className="text-xl font-bold text-ramos-accent">100</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                {/* IMPORT FLOW */}
                {createFlow === 'import' && (
                  <div className="space-y-8">
                    {createStep === 1 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.chooseImportMethod}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <button 
                            onClick={() => { setImportType('file'); setCreateStep(2); }}
                            className="p-10 bg-white border-2 border-ramos-border rounded-[40px] hover:border-ramos-accent transition-all flex flex-col items-center gap-6 group"
                          >
                            <div className="w-20 h-20 rounded-[32px] bg-ramos-gray flex items-center justify-center group-hover:bg-ramos-accent group-hover:text-white transition-all">
                              <FileUp className="w-10 h-10" />
                            </div>
                            <div className="text-center">
                              <h4 className="text-xl font-bold mb-2">{t.importFile}</h4>
                              <p className="text-xs text-ramos-muted">{t.supportFormats}</p>
                            </div>
                          </button>
                          <button 
                            onClick={() => { setImportType('url'); setCreateStep(2); }}
                            className="p-10 bg-white border-2 border-ramos-border rounded-[40px] hover:border-ramos-accent transition-all flex flex-col items-center gap-6 group"
                          >
                            <div className="w-20 h-20 rounded-[32px] bg-ramos-gray flex items-center justify-center group-hover:bg-ramos-accent group-hover:text-white transition-all">
                              <Languages className="w-10 h-10" />
                            </div>
                            <div className="text-center">
                              <h4 className="text-xl font-bold mb-2">{t.pasteUrl}</h4>
                              <p className="text-xs text-ramos-muted">{t.importFromSillyTavern}</p>
                            </div>
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {createStep === 2 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{importType === 'file' ? t.importFile : t.pasteUrl}</h3>
                        {importType === 'file' ? (
                          <div
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                            className="border-2 border-dashed border-ramos-border rounded-[40px] p-12 flex flex-col items-center justify-center gap-6 bg-ramos-gray/30 hover:bg-ramos-gray transition-all cursor-pointer"
                          >
                            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-sm">
                              <PlusCircle className="w-8 h-8 text-ramos-accent" />
                            </div>
                            <div className="text-center">
                              {importFile ? (
                                <>
                                  <p className="font-bold text-lg mb-1">{importFile.name}</p>
                                  <p className="text-xs text-ramos-muted">{(importFile.size / 1024).toFixed(1)} KB</p>
                                </>
                              ) : (
                                <>
                                  <p className="font-bold text-lg mb-1">{t.selectFile}</p>
                                  <p className="text-xs text-ramos-muted">{t.dragAndDrop}</p>
                                </>
                              )}
                            </div>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".json,.png"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
                              className="hidden"
                            />
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">URL</label>
                            <input 
                              type="text" 
                              value={importUrl}
                              onChange={(e) => setImportUrl(e.target.value)}
                              placeholder="https://..."
                              className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all font-medium"
                            />
                            <p className="text-[10px] text-ramos-muted italic">{t.pasteUrlDescription}</p>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {createStep === 3 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.parsePreview}</h3>
                        {importPreview?.error ? (
                          <div className="p-6 bg-red-50 border border-red-200 rounded-[24px] text-red-700 text-sm">
                            {importPreview.error}
                          </div>
                        ) : (
                          <div className="bento-card p-8 space-y-6">
                            <div className="flex items-center gap-6">
                              <div className="w-20 h-20 rounded-[28px] bg-ramos-gray flex items-center justify-center">
                                <User className="w-10 h-10 text-ramos-muted opacity-30" />
                              </div>
                              <div>
                                <h4 className="text-2xl font-bold">{importPreview?.name || createForm.name || 'Unknown'}</h4>
                                <p className="text-xs text-ramos-muted">{importPreview?.personality?.slice(0, 80) || 'No personality data'}{importPreview?.personality?.length > 80 ? '...' : ''}</p>
                              </div>
                            </div>
                            {importPreview?.firstMes && (
                              <div className="p-4 bg-ramos-gray/50 rounded-2xl">
                                <p className="text-[10px] text-ramos-muted uppercase tracking-widest font-bold mb-2">{t.greeting || 'Greeting'}</p>
                                <p className="text-sm text-ramos-muted italic">{importPreview.firstMes.slice(0, 200)}{importPreview.firstMes.length > 200 ? '...' : ''}</p>
                              </div>
                            )}
                            <div className="space-y-4">
                              <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.bio}</label>
                              <textarea
                                value={createForm.bio}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, bio: e.target.value }))}
                                className="w-full bg-ramos-gray border border-ramos-border rounded-[24px] p-5 text-sm focus:outline-none focus:border-ramos-accent/50 transition-all resize-none font-medium"
                                rows={3}
                              />
                            </div>
                            {importPreview?.tags?.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {importPreview.tags.slice(0, 10).map((tag: string, i: number) => (
                                  <span key={i} className="px-3 py-1 bg-ramos-gray rounded-full text-[10px] font-bold text-ramos-muted uppercase tracking-wider">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}

                    {createStep === 4 && (
                      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.appearance}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {APPEARANCE_STYLES.map((style) => (
                            <button key={style.id} onClick={() => setCreateForm(prev => ({ ...prev, appearanceStyle: style.id }))} className={cn("p-4 rounded-[32px] border-2 transition-all flex flex-col items-center gap-2", createForm.appearanceStyle === style.id ? "bg-ramos-accent/5 border-ramos-accent" : "bg-white border-ramos-border hover:border-ramos-accent/30")}>
                              <span className="text-3xl">{style.icon}</span>
                              <span className="font-bold text-[10px] uppercase tracking-widest">{style.name}</span>
                            </button>
                          ))}
                        </div>
                        <button className="w-full py-6 bg-ramos-accent text-white rounded-[32px] font-bold uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl hover:scale-[1.02] transition-all">
                          <Sparkles className="w-6 h-6" />
                          Generate Photos
                        </button>
                      </motion.div>
                    )}

                    {createStep === 5 && (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
                        <h3 className="text-2xl text-display">{t.confirm}</h3>
                        <div className="flex items-center justify-between p-6 bg-ramos-gray rounded-[24px]">
                          <span className="text-xs font-bold text-ramos-muted uppercase tracking-widest">{t.energyCost}</span>
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-ramos-accent fill-current" />
                            <span className="text-xl font-bold text-ramos-accent">100</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>

              {/* Navigation Buttons */}
              <div className="flex gap-4 pt-8">
                {createFlow !== 'simple' && createStep > 1 && (
                  <button 
                    onClick={() => setCreateStep(prev => prev - 1)}
                    className="flex-1 py-5 bg-ramos-gray text-ramos-black rounded-[24px] font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-ramos-border transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t.back}
                  </button>
                )}
                <button 
                  onClick={() => {
                    const maxSteps = createFlow === 'simple' ? 1 : createFlow === 'detailed' ? 6 : 5;
                    if (createStep < maxSteps) {
                      setCreateStep(prev => prev + 1);
                    } else {
                      handleGenerateCharacter();
                    }
                  }}
                  disabled={isGenerating || (createFlow !== 'simple' && createStep === 1 && !createForm.name) || (createFlow === 'simple' && (!createForm.name || !createForm.personalityTemplate || !createForm.appearanceStyle)) || (createFlow === 'import' && createStep === 2 && !importPreview)}
                  className="flex-[2] py-5 bg-ramos-accent text-white rounded-[24px] font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {createFlow === 'simple' || createStep === (createFlow === 'detailed' ? 6 : 5) ? (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {t.confirm}
                    </>
                  ) : (
                    <>
                      {t.next}
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {activeView === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
              className="space-y-12 pt-6 px-6 pb-32 overflow-y-auto h-full max-w-6xl mx-auto w-full relative"
            >
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="absolute top-6 right-6 p-3 md:p-4 rounded-2xl bg-white border border-ramos-border hover:bg-ramos-gray transition-all shadow-sm z-10"
              >
                <Settings className="w-5 h-5 md:w-6 md:h-6 text-ramos-muted" />
              </button>

              <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
                <div className="flex items-center gap-4 md:gap-6">
                  <div className="relative">
                    <div className="w-20 h-20 md:w-32 md:h-32 rounded-[28px] md:rounded-[48px] bg-ramos-gray border-2 border-ramos-accent p-1 rotate-2 shadow-xl">
                      <img 
                        src="https://picsum.photos/seed/user/400/400" 
                        alt="User"
                        className="w-full h-full rounded-[20px] md:rounded-[40px] object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-ramos-accent p-1.5 md:p-3 rounded-lg md:rounded-2xl border-2 border-white shadow-lg">
                      <Sparkles className="w-2.5 h-2.5 md:w-4 md:h-4 text-white" />
                    </div>
                  </div>
                  <div className="text-left">
                    <h2 className="text-2xl md:text-5xl text-display mb-0.5 md:mb-1">{profileData?.username || t.soulExplorer}</h2>
                    <p className="text-ramos-muted text-xs md:text-base font-medium">{profileData?.membershipTier ? `${profileData.membershipTier} member` : t.userLevelInfo}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 md:gap-6">
                <div className="bento-card p-4 md:p-8 text-center flex flex-col items-center justify-center">
                  <span className="text-2xl md:text-5xl text-display text-ramos-accent">{profileData?.friendsCount ?? friends.length}</span>
                  <p className="text-[8px] md:text-xs text-accent text-ramos-muted mt-1 md:mt-3 uppercase tracking-widest font-bold">{t.friends}</p>
                </div>
                <div className="bento-card p-4 md:p-8 text-center flex flex-col items-center justify-center">
                  <span className="text-2xl md:text-5xl text-display text-ramos-accent">
                    {profileData?.creationsCount ?? characters.filter(c => c.isCustom).length}
                  </span>
                  <p className="text-[8px] md:text-xs text-accent text-ramos-muted mt-1 md:mt-3 uppercase tracking-widest font-bold">{t.creations}</p>
                </div>
                <div className="bento-card p-4 md:p-8 text-center flex flex-col items-center justify-center">
                  <span className="text-2xl md:text-5xl text-display text-ramos-accent">—</span>
                  <p className="text-[8px] md:text-xs text-accent text-ramos-muted mt-1 md:mt-3 uppercase tracking-widest font-bold">{t.likes}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bento-card space-y-6 md:space-y-8 p-6 md:p-10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl md:text-2xl text-display">{t.energyStatus}</h3>
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 md:w-5 md:h-5 text-ramos-accent fill-current" />
                      <span className="text-lg md:text-xl font-bold text-ramos-accent">{energy}</span>
                    </div>
                  </div>
                  <div className="w-full h-2 md:h-3 bg-ramos-gray rounded-full overflow-hidden shadow-inner">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (energy / 1000) * 100)}%` }}
                      className="h-full bg-ramos-accent shadow-[0_0_20px_rgba(255,92,0,0.5)]"
                    />
                  </div>
                  <p className="text-[10px] md:text-xs text-accent text-ramos-muted leading-relaxed">{t.energyDescription}</p>
                  <div className="grid grid-cols-3 gap-2 md:gap-3">
                    <button 
                      onClick={() => { setRechargeTab('subscribe'); setIsRechargeOpen(true); }}
                      className="bg-ramos-accent text-white py-3 md:py-4 rounded-xl md:rounded-2xl text-[8px] md:text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg hover:scale-105 active:scale-95"
                    >
                      {t.subscribe}
                    </button>
                    <button 
                      onClick={() => { setRechargeTab('recharge'); setIsRechargeOpen(true); }}
                      className="bg-ramos-gray hover:bg-ramos-border py-3 md:py-4 rounded-xl md:rounded-2xl text-[8px] md:text-[10px] font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                    >
                      {t.recharge}
                    </button>
                    <button 
                      onClick={() => { setRechargeTab('earn'); setIsRechargeOpen(true); }}
                      className="bg-ramos-gray hover:bg-ramos-border py-3 md:py-4 rounded-xl md:rounded-2xl text-[8px] md:text-[10px] font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                    >
                      {t.earn}
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs text-accent text-ramos-muted uppercase tracking-widest font-bold">{t.myCreations}</h3>
                    <button 
                      onClick={() => setActiveView('create')}
                      className="text-[10px] text-ramos-accent font-bold uppercase tracking-widest hover:underline"
                    >
                      {t.createNow}
                    </button>
                  </div>
                  <div className="bg-white rounded-[40px] overflow-hidden border border-ramos-border shadow-sm">
                    {characters.filter(c => c.isCustom).length > 0 ? (
                      characters.filter(c => c.isCustom).map((char, idx) => (
                        <button 
                          key={char.id}
                          onClick={() => startChat(char)}
                          className={`w-full px-5 md:px-8 py-4 md:py-6 flex items-center justify-between hover:bg-ramos-gray transition-colors group ${idx !== characters.filter(c => c.isCustom).length - 1 ? 'border-b border-ramos-border' : ''}`}
                        >
                          <div className="flex items-center gap-3 md:gap-5">
                            <div className="relative">
                              <img src={char.avatar} alt={char.name} className="w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl object-cover border border-ramos-border group-hover:scale-110 transition-transform" referrerPolicy="no-referrer" />
                              {char.isCustom && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-ramos-accent rounded-full border-2 border-white" />}
                            </div>
                            <div className="text-left">
                              <span className="text-base md:text-lg font-bold block group-hover:text-ramos-accent transition-colors">{char.name}</span>
                              <span className="text-[8px] md:text-[10px] text-ramos-muted uppercase tracking-widest font-medium">{language === 'en' ? char.tagline_en || char.tagline : char.tagline}</span>
                            </div>
                          </div>
                          <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-ramos-gray flex items-center justify-center text-ramos-muted group-hover:bg-ramos-accent group-hover:text-white transition-all">
                            <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-8 py-20 text-center space-y-6">
                        <div className="w-20 h-20 bg-ramos-gray rounded-[32px] flex items-center justify-center mx-auto opacity-50">
                          <PlusCircle className="w-10 h-10 text-ramos-muted" />
                        </div>
                        <p className="text-sm text-ramos-muted italic">{t.noCreations}</p>
                        <button 
                          onClick={() => setActiveView('create')}
                          className="text-xs text-ramos-accent font-bold uppercase tracking-widest border-2 border-ramos-accent/20 px-8 py-3 rounded-2xl hover:bg-ramos-accent hover:text-white transition-all shadow-sm"
                        >
                          {t.createNow}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 backdrop-blur-md p-4"
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[40px] p-8 space-y-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl text-display">{t.accountSettings}</h3>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 rounded-full hover:bg-ramos-gray">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="bg-ramos-gray rounded-[32px] overflow-hidden border border-ramos-border">
                <button 
                  onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
                  className="w-full px-8 py-5 flex items-center justify-between hover:bg-ramos-border border-b border-ramos-border transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Languages className="w-5 h-5 text-ramos-muted" />
                    <span className="text-sm font-medium">{t.language}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ramos-muted">{language === 'en' ? 'English' : '中文'}</span>
                    <ChevronRight className="w-5 h-5 text-ramos-muted" />
                  </div>
                </button>
                <button className="w-full px-8 py-5 flex items-center justify-between hover:bg-ramos-border border-b border-ramos-border transition-colors">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-ramos-muted" />
                    <span className="text-sm font-medium">{t.privacy}</span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-ramos-muted" />
                </button>
                <button className="w-full px-8 py-5 flex items-center justify-between hover:bg-ramos-border border-b border-ramos-border transition-colors">
                  <div className="flex items-center gap-3">
                    <HelpCircle className="w-5 h-5 text-ramos-muted" />
                    <span className="text-sm font-medium">{t.help}</span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-ramos-muted" />
                </button>
                <button 
                  onClick={() => {
                    if (confirm("Are you sure you want to logout?")) {
                      api.setToken(null);
                      setIsLoggedIn(false);
                      setIsSettingsOpen(false);
                      setMessages({});
                      setFriends([]);
                      setProfileData(null);
                      setCharacters(INITIAL_CHARACTERS);
                    }
                  }}
                  className="w-full px-8 py-5 flex items-center justify-between hover:bg-red-500/10 text-red-500 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <LogOut className="w-5 h-5" />
                    <span className="text-sm font-medium">{t.logout}</span>
                  </div>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

        {/* Payment Modal */}
        <AnimatePresence>
          {isPaymentOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
              onClick={() => setIsPaymentOpen(false)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-sm bg-white rounded-[40px] p-8 space-y-8"
                onClick={e => e.stopPropagation()}
              >
                <div className="text-center">
                  <h3 className="text-2xl text-display mb-2">{t.checkout}</h3>
                  <p className="text-ramos-muted text-sm">You are purchasing {selectedPlan?.label || selectedPlan?.energy + ' Energy'}</p>
                  <div className="mt-4 text-3xl font-bold text-ramos-accent">{selectedPlan?.price}</div>
                </div>

                <div className="space-y-4">
                  <p className="text-[10px] text-ramos-muted uppercase tracking-widest font-bold">{t.selectPayment}</p>
                  
                  <button 
                    onClick={() => {
                      alert('Stripe payment initiated...');
                      setIsPaymentOpen(false);
                      setIsRechargeOpen(false);
                      setEnergy(prev => prev + 20); // Mock energy increase
                    }}
                    className="w-full p-6 bg-ramos-gray border border-ramos-border rounded-[32px] flex items-center gap-4 hover:bg-ramos-border transition-all group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#635BFF] flex items-center justify-center text-white shadow-lg">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <h4 className="font-bold">Stripe</h4>
                      <p className="text-[10px] text-ramos-muted">Credit / Debit Card</p>
                    </div>
                    <ChevronRight className="ml-auto w-5 h-5 text-ramos-muted" />
                  </button>

                  <button 
                    onClick={() => {
                      alert('Web3 wallet connection initiated...');
                      setIsPaymentOpen(false);
                      setIsRechargeOpen(false);
                    }}
                    className="w-full p-6 bg-ramos-gray border border-ramos-border rounded-[32px] flex items-center gap-4 hover:bg-ramos-border transition-all group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-ramos-accent flex items-center justify-center text-white shadow-lg">
                      <Zap className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <h4 className="font-bold">Web3 Wallet</h4>
                      <p className="text-[10px] text-ramos-muted">ETH / SOL / USDC</p>
                    </div>
                    <ChevronRight className="ml-auto w-5 h-5 text-ramos-muted" />
                  </button>
                </div>

                <button 
                  onClick={() => setIsPaymentOpen(false)}
                  className="w-full py-4 text-sm font-bold text-ramos-muted hover:text-black transition-colors"
                >
                  {t.cancel}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      {/* Mobile Navigation Bar */}
      {!(activeView === 'chat' && selectedCharacter) && (
        <div className="md:hidden fixed bottom-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="pointer-events-auto flex items-center gap-1 bg-black/90 backdrop-blur-3xl border border-white/10 rounded-[32px] p-1.5 shadow-2xl w-full max-w-[320px]"
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => { 
                  setActiveView(item.id as View); 
                  if(item.id === 'discover') setSelectedCharacter(null); 
                }}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center h-14 rounded-[24px] transition-all duration-300",
                  activeView === item.id 
                    ? "bg-ramos-accent text-white shadow-lg" 
                    : "text-white/40 hover:text-white"
                )}
              >
                <div className={cn("transition-transform duration-300", activeView === item.id && "scale-110")}>
                  {item.icon}
                </div>
                <span className="text-[7px] mt-1 uppercase tracking-[0.1em] font-extrabold opacity-80">{item.label}</span>
              </button>
            ))}
          </motion.div>
        </div>
      )}
    </div> {/* End Main App Container */}
      {/* Character Profile Modal */}
      <AnimatePresence>
        {isCharProfileOpen && currentDiscoverChar && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 backdrop-blur-md p-4"
            onClick={() => setIsCharProfileOpen(false)}
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[40px] overflow-hidden flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative h-96 shrink-0 group">
                <AnimatePresence mode="wait">
                  <motion.img 
                    key={currentImageIndex}
                    src={(currentDiscoverChar.images || [currentDiscoverChar.avatar])[currentImageIndex]} 
                    alt={currentDiscoverChar.name} 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full object-cover" 
                  />
                </AnimatePresence>
                <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
                
                {/* Image Navigation for Modal */}
                <div className="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const images = currentDiscoverChar.images || [currentDiscoverChar.avatar];
                      setCurrentImageIndex(prev => (prev > 0 ? prev - 1 : images.length - 1));
                    }}
                    className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const images = currentDiscoverChar.images || [currentDiscoverChar.avatar];
                      setCurrentImageIndex(prev => (prev < images.length - 1 ? prev + 1 : 0));
                    }}
                    className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Indicators */}
                <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-1.5 px-8">
                  {(currentDiscoverChar.images || [currentDiscoverChar.avatar]).map((_, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "h-1 w-8 rounded-full transition-all duration-300",
                        idx === currentImageIndex ? "bg-ramos-accent" : "bg-black/10"
                      )}
                    />
                  ))}
                </div>

                <button 
                  onClick={() => setIsCharProfileOpen(false)}
                  className="absolute top-6 right-6 w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white z-10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-8 space-y-8 overflow-y-auto">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-5xl text-display mb-2">{currentDiscoverChar.name}</h3>
                    <p className="text-ramos-accent text-sm font-accent tracking-widest uppercase">{language === 'en' ? currentDiscoverChar.tagline_en || currentDiscoverChar.tagline : currentDiscoverChar.tagline}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-ramos-accent bg-ramos-accent/10 px-4 py-2 rounded-2xl">
                    <Sparkles className="w-5 h-5 fill-current" />
                    <span className="text-lg font-bold font-accent">{currentDiscoverChar.rating || '4.8'}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-ramos-gray p-4 rounded-3xl space-y-1">
                    <p className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{t.age}</p>
                    <p className="text-sm font-bold">{currentDiscoverChar.age || t.unknown} {t.years}</p>
                  </div>
                  <div className="bg-ramos-gray p-4 rounded-3xl space-y-1">
                    <p className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{t.worldview}</p>
                    <p className="text-sm font-bold truncate">{language === 'en' ? currentDiscoverChar.world_en || currentDiscoverChar.world : currentDiscoverChar.world || t.unknown}</p>
                  </div>
                  <div className="bg-ramos-gray p-4 rounded-3xl space-y-1">
                    <p className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{t.race}</p>
                    <p className="text-sm font-bold">{language === 'en' ? currentDiscoverChar.race_en || currentDiscoverChar.race : currentDiscoverChar.race || t.unknown}</p>
                  </div>
                  <div className="bg-ramos-gray p-4 rounded-3xl space-y-1">
                    <p className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{t.occupation}</p>
                    <p className="text-sm font-bold truncate">{language === 'en' ? currentDiscoverChar.occupation_en || currentDiscoverChar.occupation : currentDiscoverChar.occupation || t.unknown}</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h4 className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{t.bio}</h4>
                  <p className="text-base text-ramos-muted leading-relaxed font-medium">{language === 'en' ? currentDiscoverChar.description_en || currentDiscoverChar.description : currentDiscoverChar.description}</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{t.personality}</h4>
                  <p className="text-base text-ramos-muted leading-relaxed font-medium italic bg-ramos-gray p-6 rounded-[32px]">"{language === 'en' ? currentDiscoverChar.personality_en || currentDiscoverChar.personality : currentDiscoverChar.personality}"</p>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => { startChat(currentDiscoverChar); setIsCharProfileOpen(false); }}
                    className="btn-primary w-full py-6 text-xl flex items-center justify-center gap-4"
                  >
                    <MessageSquare className="w-7 h-7" />
                    Start Connection
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Friends List Modal */}
      <AnimatePresence>
        {isFriendsListOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setIsFriendsListOpen(false)}
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[40px] p-8 space-y-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl text-display">{t.friendsList}</h3>
                <button onClick={() => setIsFriendsListOpen(false)} className="p-2 rounded-full hover:bg-ramos-gray">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                {(friends.length > 0 ? friends : characters).map(char => (
                  <div
                    key={char.id}
                    onClick={() => { startChat(char); setIsFriendsListOpen(false); }}
                    className="flex items-center gap-4 p-3 rounded-2xl border border-ramos-border hover:bg-ramos-gray transition-colors cursor-pointer group"
                  >
                    <img src={char.avatar} alt={char.name} className="w-12 h-12 rounded-xl object-cover border border-ramos-border group-hover:scale-105 transition-transform" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-lg text-display truncate">{char.name}</h4>
                      <p className="text-[10px] text-ramos-muted truncate font-medium uppercase tracking-wider">{char.tagline}</p>
                    </div>
                    <div className="p-2 bg-ramos-accent/10 text-ramos-accent rounded-xl group-hover:bg-ramos-accent group-hover:text-white transition-colors">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recharge Modal */}
      <AnimatePresence>
        {isRechargeOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 backdrop-blur-md p-4"
            onClick={() => setIsRechargeOpen(false)}
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[40px] p-8 space-y-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                      <div className="flex gap-4">
                        {['subscribe', 'recharge', 'earn'].map((tab) => (
                          <button
                            key={tab}
                            onClick={() => setRechargeTab(tab as any)}
                            className={cn(
                              "text-xs font-bold uppercase tracking-widest transition-all pb-1 border-b-2",
                              rechargeTab === tab ? "text-ramos-accent border-ramos-accent" : "text-ramos-muted border-transparent"
                            )}
                          >
                            {tab === 'subscribe' ? t.subscribe : (tab === 'recharge' ? t.recharge : (language === 'en' ? 'Earn' : '赚取'))}
                          </button>
                        ))}
                      </div>
                <button onClick={() => setIsRechargeOpen(false)} className="p-2 rounded-full hover:bg-ramos-gray">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4 min-h-[300px]">
                {rechargeTab === 'subscribe' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {[
                      { price: '$9.9', label: 'Basic Soul', features: '1000 Energy/mo' },
                      { price: '$39.9', label: 'Explorer', features: '5000 Energy/mo' },
                      { price: '$99.9', label: 'God Mode', features: 'Unlimited Energy' }
                    ].map((plan) => (
                      <button 
                        key={plan.price} 
                        onClick={() => { setSelectedPlan(plan); setIsPaymentOpen(true); }}
                        className="w-full p-6 bg-ramos-gray border border-ramos-border rounded-[32px] flex items-center justify-between hover:bg-ramos-border transition-all group"
                      >
                        <div className="text-left">
                          <h4 className="text-lg font-bold">{plan.label}</h4>
                          <p className="text-xs text-ramos-muted">{plan.features}</p>
                        </div>
                        <div className="text-ramos-accent font-bold text-xl">{plan.price}</div>
                      </button>
                    ))}
                  </div>
                )}

                {rechargeTab === 'recharge' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { energy: '100', price: '$1.99' },
                        { energy: '500', price: '$7.99' },
                        { energy: '1000', price: '$14.99' },
                        { energy: '2500', price: '$29.99' }
                      ].map((pack) => (
                        <button 
                          key={pack.energy} 
                          onClick={() => { setSelectedPlan(pack); setIsPaymentOpen(true); }}
                          className="p-6 bg-ramos-gray border border-ramos-border rounded-[32px] flex flex-col items-center gap-2 hover:bg-ramos-border transition-all"
                        >
                          <Zap className="w-8 h-8 text-ramos-accent" />
                          <span className="font-bold">{pack.energy} Energy</span>
                          <span className="text-xs text-ramos-muted">{pack.price}</span>
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={() => { setSelectedPlan({ label: 'Lucky Gift Box', price: '$4.99' }); setIsPaymentOpen(true); }}
                      className="w-full p-6 bg-ramos-accent/5 border border-ramos-accent/20 rounded-[32px] flex items-center gap-5 hover:bg-ramos-accent/10 transition-all group"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-ramos-accent flex items-center justify-center text-white shadow-lg">
                        <Gift className="w-7 h-7" />
                      </div>
                      <div className="text-left">
                        <h4 className="text-lg font-bold">Lucky Gift Box</h4>
                        <p className="text-xs text-ramos-muted">Get random 50-500 energy</p>
                      </div>
                      <span className="ml-auto text-ramos-accent font-bold">$4.99</span>
                    </button>
                  </div>
                )}

                {rechargeTab === 'earn' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {[
                      { icon: <Check className="w-6 h-6" />, label: 'Daily Check-in', reward: '+50 Energy', action: async () => {
                        try {
                          const res = await api.user.dailyCheckin();
                          setEnergy(res.newBalance ?? res.new_balance ?? energy + 50);
                          alert(`+${res.energyGained ?? res.energy_gained ?? 50} Energy!`);
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Check-in failed');
                        }
                      }},
                      { icon: <Users className="w-6 h-6" />, label: 'Share with Friends', reward: '+50 Energy', action: () => {} },
                      { icon: <Sparkles className="w-6 h-6" />, label: 'Watch Ad', reward: '+5 Energy', action: () => {} }
                    ].map((task) => (
                      <button key={task.label} onClick={task.action} className="w-full p-6 bg-ramos-gray border border-ramos-border rounded-[32px] flex items-center gap-5 hover:bg-ramos-border transition-all group">
                        <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-ramos-accent shadow-sm">
                          {task.icon}
                        </div>
                        <div className="text-left">
                          <h4 className="text-lg font-bold">{task.label}</h4>
                          <p className="text-xs text-ramos-muted">Complete to earn rewards</p>
                        </div>
                        <span className="ml-auto text-ramos-accent font-bold">{task.reward}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Modal */}
      <AnimatePresence>
        {isFilterOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setIsFilterOpen(false)}
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[40px] p-8 space-y-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl text-display">Filter Souls</h3>
                <button onClick={() => setIsFilterOpen(false)} className="p-2 rounded-full hover:bg-ramos-gray">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                {[
                  { label: 'Gender', key: 'gender', options: ['All', 'Male', 'Female', 'Non-binary'] },
                  { label: 'Race', key: 'race', options: ['All', 'Human', 'Deity', 'Android', 'Elf', 'Beast'] },
                  { label: 'Occupation', key: 'occupation', options: ['All', 'Hacker', 'Explorer', 'Guardian', 'Artist', 'Psychologist', 'Wellness Expert'] }
                ].map(group => (
                  <div key={group.key} className="space-y-3">
                    <label className="text-[10px] text-accent text-ramos-muted uppercase tracking-widest">{group.label}</label>
                    <div className="flex flex-wrap gap-2">
                      {group.options.map(opt => (
                        <button
                          key={opt}
                          onClick={() => setFilters(prev => ({ ...prev, [group.key]: opt }))}
                          className={cn(
                            "px-4 py-2 rounded-full text-xs font-medium transition-all",
                            filters[group.key as keyof typeof filters] === opt
                              ? "bg-ramos-accent text-white shadow-lg"
                              : "bg-ramos-gray text-ramos-muted hover:bg-ramos-border"
                          )}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setIsFilterOpen(false)}
                className="btn-primary w-full py-5 text-lg"
              >
                Apply Filters
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Age Verification Modal */}
      <AnimatePresence>
        {showAgeVerification && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-white rounded-[40px] p-10 text-center space-y-8 shadow-2xl"
            >
              <div className="w-20 h-20 bg-ramos-accent/10 rounded-full flex items-center justify-center mx-auto">
                <Shield className="w-10 h-10 text-ramos-accent" />
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl text-display">{t.ageVerification}</h3>
                <p className="text-sm text-ramos-muted leading-relaxed">{t.ageVerificationDesc}</p>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => setShowAgeVerification(false)}
                  className="w-full py-5 bg-ramos-accent text-white rounded-full font-bold text-sm shadow-lg shadow-ramos-accent/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  {t.confirmAge}
                </button>
                <button 
                  onClick={() => {
                    setShowAgeVerification(false);
                    setCreateForm(prev => ({ ...prev, rpMode: 'sfw' }));
                  }}
                  className="w-full py-5 bg-ramos-gray text-ramos-muted rounded-full font-bold text-sm hover:bg-ramos-border transition-all"
                >
                  {t.cancel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, isDark }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, isDark?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex-1 flex flex-col items-center gap-1 py-2 rounded-[24px] transition-all duration-500 relative overflow-hidden",
        active 
          ? "text-ramos-accent" 
          : isDark ? "text-white/70 hover:text-white" : "text-ramos-muted hover:text-black"
      )}
    >
      {active && (
        <motion.div 
          layoutId="nav-glow"
          className="absolute inset-0 bg-ramos-accent/5 blur-2xl"
        />
      )}
      <div className={cn("transition-transform duration-500", active && "scale-110")}>
        {icon}
      </div>
      <span className="text-[8px] text-accent font-bold">{label}</span>
    </button>
  );
}


