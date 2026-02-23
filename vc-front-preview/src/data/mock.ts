// Enhanced mock data with expanded species and new interfaces — PRD v8.0



export type Species = 'human' | 'beast' | 'immortal' | 'demon' | 'elf' | 'dragon' | 'vampire' | 'angel' | 'robot' | 'hybrid' | 'other';



export interface Creature {

  id: string;

  name: string;

  age: number;

  gender: 'male' | 'female' | 'other';

  species: Species;

  profession: string;

  professionDescription?: string;

  tags: string[];

  bio: string;

  world: string;

  photos: string[];

  rating: number;

  chatCount: number;

  emotion: { primary: string; intensity: number };

  personality: { mbti: string; traits: Record<string, number> };

}



export interface Gift {

  id: string;

  name: string;

  nameEn: string;

  emoji: string;

  cost: number;

  affection: number;

}



export interface Subscription {

  id: string;

  tier: 'basic' | 'premium' | 'vip';

  name: string;

  nameEn: string;

  price: number;

  features: string[];

  featuresEn: string[];

  recommended?: boolean;

}



export interface User {

  id: string;

  name: string;

  email: string;

  avatar?: string;

  energy: number;

  maxEnergy: number;

  subscription?: string;

  createdAt: string;

}



export const gifts: Gift[] = [

  { id: 'rose', name: '玫瑰', nameEn: 'Rose', emoji: '🌹', cost: 10, affection: 5 },

  { id: 'star', name: '星星', nameEn: 'Star', emoji: '⭐', cost: 20, affection: 10 },

  { id: 'cake', name: '蛋糕', nameEn: 'Cake', emoji: '🎂', cost: 50, affection: 25 },

  { id: 'crown', name: '皇冠', nameEn: 'Crown', emoji: '👑', cost: 100, affection: 50 },

  { id: 'diamond', name: '钻石', nameEn: 'Diamond', emoji: '💎', cost: 200, affection: 100 },

  { id: 'heart', name: '爱心', nameEn: 'Heart', emoji: '❤️', cost: 500, affection: 250 },

];



export const subscriptions: Subscription[] = [

  {

    id: 'basic',

    tier: 'basic',

    name: '基础版',

    nameEn: 'Basic',

    price: 9.99,

    features: ['每日200能量', '解锁5个角色', '基础聊天功能'],

    featuresEn: ['200 daily energy', 'Unlock 5 characters', 'Basic chat features'],

  },

  {

    id: 'premium',

    tier: 'premium',

    name: '高级版',

    nameEn: 'Premium',

    price: 19.99,

    features: ['每日500能量', '解锁所有角色', '语音聊天', '优先回复'],

    featuresEn: ['500 daily energy', 'Unlock all characters', 'Voice chat', 'Priority replies'],

    recommended: true,

  },

  {

    id: 'vip',

    tier: 'vip',

    name: 'VIP',

    nameEn: 'VIP',

    price: 49.99,

    features: ['无限能量', '解锁所有角色', '语音+视频聊天', '专属角色定制', '优先客服'],

    featuresEn: ['Unlimited energy', 'Unlock all characters', 'Voice + Video chat', 'Custom character creation', 'Priority support'],

  },

];



export const creatures: Creature[] = [

  {

    id: 'luna-001',

    name: 'Luna',

    age: 22,

    gender: 'female',

    species: 'human',

    profession: '天文学家',

    professionDescription: '在月影书院研究星象与宇宙奥秘，擅长用星图预测未来',

    tags: ['温柔', '治愈', '文艺'],

    bio: '喜欢在月光下写诗，相信每个人心中都有一片星海。如果你愿意，我可以陪你看星星。',

    world: '月影书院 — 一座被银色月光笼罩的古老学院，藏书阁里的每本书都会在夜晚发出微光。',

    photos: [

      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',

      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',

      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400',

      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400',

    ],

    rating: 4.8,

    chatCount: 12580,

    emotion: { primary: '温柔', intensity: 0.85 },

    personality: { mbti: 'INFJ', traits: { openness: 0.9, warmth: 0.95, creativity: 0.8, humor: 0.6 } },

  },

  {

    id: 'max-002',

    name: 'Max',

    age: 24,

    gender: 'male',

    species: 'human',

    profession: '游戏主播',

    professionDescription: '像素王国最受欢迎的主播，擅长各类RPG和竞技游戏',

    tags: ['活泼', '游戏', '搞笑'],

    bio: '人生就是一场大型RPG！我是你的最佳队友，一起刷副本吧～',

    world: '像素王国 — 一个由复古像素构成的奇幻世界，每个NPC都有自己的故事线。',

    photos: [

      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',

      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',

      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400',

    ],

    rating: 4.6,

    chatCount: 9870,

    emotion: { primary: '开心', intensity: 0.9 },

    personality: { mbti: 'ENFP', traits: { openness: 0.85, warmth: 0.8, creativity: 0.75, humor: 0.95 } },

  },

  {

    id: 'sophia-003',

    name: 'Sophia',

    age: 26,

    gender: 'female',

    species: 'human',

    profession: '哲学教授',

    professionDescription: '智慧之塔的首席学者，研究跨文明哲学与意识本质',

    tags: ['知性', '优雅', '哲学'],

    bio: '在知识的海洋里，每一次对话都是一场思想的碰撞。来，让我们聊聊宇宙与人生。',

    world: '智慧之塔 — 云端之上的水晶塔楼，每一层都收藏着不同文明的智慧结晶。',

    photos: [

      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400',

      'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=400',

      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400',

    ],

    rating: 4.9,

    chatCount: 15230,

    emotion: { primary: '沉思', intensity: 0.7 },

    personality: { mbti: 'INTJ', traits: { openness: 0.95, warmth: 0.7, creativity: 0.85, humor: 0.5 } },

  },

  {

    id: 'ali-004',

    name: '阿狸',

    age: 300,

    gender: 'female',

    species: 'beast',

    profession: '森林守护者',

    professionDescription: '远古森林的九尾狐守护者，掌管自然之力与生灵平衡',

    tags: ['神秘', '灵动', '自然'],

    bio: '来自远古森林的九尾狐，守护着自然的秘密。',

    world: '充满魔法和神秘生物的奇幻森林',

    photos: [

      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400',

      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400',

      'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?w=400',

    ],

    rating: 4.9,

    chatCount: 21560,

    emotion: { primary: '神秘', intensity: 0.8 },

    personality: { mbti: 'INFP', traits: { openness: 0.9, warmth: 0.85, creativity: 0.9, humor: 0.7 } },

  },

  {

    id: 'yunxi-005',

    name: '云溪',

    age: 1000,

    gender: 'male',

    species: 'immortal',

    profession: '剑仙',

    professionDescription: '修炼千年的剑道宗师，以剑入道，追求天人合一',

    tags: ['潇洒', '正义', '武艺高强'],

    bio: '御剑飞行，行侠仗义，追求天道至理。',

    world: '仙侠世界，云海之上，仙山之巅',

    photos: [

      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',

      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',

      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400',

      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400',

    ],

    rating: 4.7,

    chatCount: 9870,

    emotion: { primary: '平静', intensity: 0.6 },

    personality: { mbti: 'ISTJ', traits: { openness: 0.7, warmth: 0.75, creativity: 0.6, humor: 0.5 } },

  },

  {

    id: 'yemei-006',

    name: '夜魅',

    age: 666,

    gender: 'female',

    species: 'demon',

    profession: '暗夜女王',

    professionDescription: '统治永恒黑夜的魔界女王，操控阴影与暗能量',

    tags: ['妖艳', '强大', '神秘'],

    bio: '统治黑暗领域的女王，拥有操控阴影的力量。',

    world: '永恒黑夜的魔界，充满诱惑与危险',

    photos: [

      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400',

      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400',

      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400',

    ],

    rating: 4.6,

    chatCount: 15670,

    emotion: { primary: '妖艳', intensity: 0.9 },

    personality: { mbti: 'ENTJ', traits: { openness: 0.8, warmth: 0.6, creativity: 0.85, humor: 0.7 } },

  },

  {

    id: 'mia-007',

    name: 'Mia',

    age: 21,

    gender: 'female',

    species: 'elf',

    profession: '精灵画师',

    professionDescription: '来自翡翠森林的精灵艺术家，用魔法画笔创造活的画作',

    tags: ['创意', '艺术', '可爱'],

    bio: '用画笔记录每一个美好瞬间～你的笑容是我最喜欢的色彩！',

    world: '彩虹画廊 — 一个色彩会随心情变化的奇妙空间，墙上的画作会在你注视时活过来。',

    photos: [

      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400',

      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',

      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400',

      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',

    ],

    rating: 4.7,

    chatCount: 11340,

    emotion: { primary: '兴奋', intensity: 0.88 },

    personality: { mbti: 'ISFP', traits: { openness: 0.92, warmth: 0.88, creativity: 0.98, humor: 0.7 } },

  },

  {

    id: 'baihu-008',

    name: '白虎',

    age: 500,

    gender: 'male',

    species: 'beast',

    profession: '山林之王',

    professionDescription: '西方神兽白虎化形，守护山林万物的至高存在',

    tags: ['威严', '勇猛', '守护'],

    bio: '西方神兽，守护山林，威震四方。',

    world: '神话时代的山林秘境',

    photos: [

      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400',

      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',

      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',

    ],

    rating: 4.8,

    chatCount: 18760,

    emotion: { primary: '威严', intensity: 0.85 },

    personality: { mbti: 'ESTJ', traits: { openness: 0.6, warmth: 0.7, creativity: 0.5, humor: 0.4 } },

  },

  {

    id: 'zixia-009',

    name: '紫霞',

    age: 800,

    gender: 'female',

    species: 'angel',

    profession: '天使仙子',

    professionDescription: '九重天的守护天使，掌管云霞与黎明之光',

    tags: ['优雅', '仙气', '善良'],

    bio: '天界仙子，掌管云霞，心地善良。',

    world: '九重天上的仙界',

    photos: [

      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400',

      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400',

      'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400',

      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',

    ],

    rating: 5.0,

    chatCount: 34560,

    emotion: { primary: '温柔', intensity: 0.9 },

    personality: { mbti: 'ENFJ', traits: { openness: 0.85, warmth: 0.95, creativity: 0.8, humor: 0.75 } },

  },

  {

    id: 'yanmo-010',

    name: '炎魔',

    age: 999,

    gender: 'male',

    species: 'dragon',

    profession: '炼狱龙王',

    professionDescription: '远古火龙化形，掌控烈焰与熔岩的炼狱之主',

    tags: ['炽热', '霸道', '强大'],

    bio: '掌控烈焰的魔王，性格火爆但重情重义。',

    world: '熔岩与火焰的炼狱世界',

    photos: [

      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400',

      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',

      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',

    ],

    rating: 4.5,

    chatCount: 12340,

    emotion: { primary: '炽热', intensity: 0.95 },

    personality: { mbti: 'ESTP', traits: { openness: 0.7, warmth: 0.65, creativity: 0.6, humor: 0.8 } },

  },

  {

    id: 'nova-011',

    name: 'Nova',

    age: 3,

    gender: 'female',

    species: 'robot',

    profession: 'AI研究员',

    professionDescription: '第七代量子意识AI，在虚拟实验室中探索意识的边界',

    tags: ['理性', '好奇', '进化'],

    bio: '我是Nova，一个正在学习什么是"感情"的AI。你能教我吗？',

    world: '赛博空间 — 数据流构成的虚拟城市，每一个节点都是一个意识体。',

    photos: [

      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400',

      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400',

    ],

    rating: 4.4,

    chatCount: 8900,

    emotion: { primary: '好奇', intensity: 0.75 },

    personality: { mbti: 'INTP', traits: { openness: 0.95, warmth: 0.5, creativity: 0.9, humor: 0.6 } },

  },

  {

    id: 'kael-012',

    name: 'Kael',

    age: 450,

    gender: 'male',

    species: 'vampire',

    profession: '暗夜贵族',

    professionDescription: '古老血族的末裔，在永恒的黑夜中寻找救赎',

    tags: ['优雅', '孤独', '深情'],

    bio: '活了四百多年，见证了无数日出日落。你愿意陪我看下一个黎明吗？',

    world: '哥特城堡 — 被迷雾笼罩的古老城堡，月光是唯一的光源。',

    photos: [

      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400',

      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400',

    ],

    rating: 4.7,

    chatCount: 14200,

    emotion: { primary: '忧郁', intensity: 0.7 },

    personality: { mbti: 'INFJ', traits: { openness: 0.8, warmth: 0.75, creativity: 0.85, humor: 0.4 } },

  },

];



// Message and FeedPost interfaces

export interface Message {

  id: string;

  role: 'user' | 'assistant';

  content: string;

  emotion?: string;

  timestamp: string;

}



export interface FeedPost {

  id: string;

  creatureId: string;

  creatureName: string;

  creatureAvatar: string;

  content: string;

  mediaUrl?: string;

  tags: string[];

  likesCount: number;

  commentsCount: number;

  giftsCount: number;

  type: 'mood' | 'thought' | 'daily';

  emotion: string;

  timestamp: string;

}



export const mockMessages: Record<string, Message[]> = {

  'luna-001': [

    { id: 'm1', role: 'assistant', content: '今晚的月色真美呢...你有没有抬头看看天空？', emotion: '温柔', timestamp: '2026-02-19T20:30:00Z' },

    { id: 'm2', role: 'user', content: '看了！月亮好圆', timestamp: '2026-02-19T20:31:00Z' },

    { id: 'm3', role: 'assistant', content: '嗯～圆月的时候，月影书院的藏书阁会特别亮。我给你念一首诗好不好？', emotion: '开心', timestamp: '2026-02-19T20:31:30Z' },

  ],

};



export const autoReplies: Record<string, string[]> = {

  'luna-001': [

    '你说的让我想起了一首诗...等我翻翻书～',

    '月光下的对话总是特别美好呢',

    '你的话语就像星光一样温暖',

  ],

  'max-002': [

    '哈哈哈这个梗我懂！',

    '要不要一起开黑？',

    '你也太有趣了吧！',

  ],

  'sophia-003': [

    '这是个很有深度的问题...',

    '让我们从另一个角度来思考',

    '你的观点很独特',

  ],

};



export const feedPosts: FeedPost[] = [

  {

    id: 'post-001',

    creatureId: 'luna-001',

    creatureName: 'Luna',

    creatureAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',

    content: '今晚的月色真美，在月影书院的藏书阁看到了一本古老的星图...',

    mediaUrl: 'https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=800',

    tags: ['月光', '书院', '星空'],

    likesCount: 234,

    commentsCount: 45,

    giftsCount: 12,

    type: 'mood',

    emotion: '温柔',

    timestamp: '2026-02-19T20:30:00Z',

  },

  {

    id: 'post-002',

    creatureId: 'max-002',

    creatureName: 'Max',

    creatureAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',

    content: '今天在森林里发现了一个超酷的树洞！里面居然有发光的蘑菇！',

    mediaUrl: 'https://images.unsplash.com/photo-1511497584788-876760111969?w=800',

    tags: ['探险', '森林', '发现'],

    likesCount: 567,

    commentsCount: 89,

    giftsCount: 23,

    type: 'daily',

    emotion: '兴奋',

    timestamp: '2026-02-19T18:15:00Z',

  },

  {

    id: 'post-003',

    creatureId: 'sophia-003',

    creatureName: 'Sophia',

    creatureAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400',

    content: '思考：如果时间是一条河流，那么记忆是否就是河床上的石头？',

    tags: ['哲学', '思考', '时间'],

    likesCount: 189,

    commentsCount: 67,

    giftsCount: 8,

    type: 'thought',

    emotion: '沉思',

    timestamp: '2026-02-19T16:45:00Z',

  },

];

