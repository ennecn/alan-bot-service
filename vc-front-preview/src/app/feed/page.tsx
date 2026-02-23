'use client';



import { useState } from 'react';

import { motion, AnimatePresence } from 'framer-motion';

import { Heart, MessageCircle, Gift, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { feedPosts } from '@/data/mock';



const giftOptions = [

  { name: '铜礼盒', price: 10, color: 'from-amber-600 to-amber-400' },

  { name: '银礼盒', price: 50, color: 'from-gray-400 to-gray-200' },

  { name: '金礼盒', price: 200, color: 'from-yellow-500 to-yellow-300' },

];



export default function FeedPage() {

  const [liked, setLiked] = useState<Set<string>>(new Set());

  const [giftTarget, setGiftTarget] = useState<string | null>(null);



  const toggleLike = (id: string) => {

    setLiked((prev) => {

      const next = new Set(prev);

      if (next.has(id)) next.delete(id);

      else next.add(id);

      return next;

    });

  };



  return (

    <div className="relative min-h-full">

      <div className="px-5 pt-[env(safe-area-inset-top)] h-14 flex items-center">

        <h1 className="text-lg font-semibold text-gray-800">动态</h1>

      </div>



      {/* Masonry grid */}

      <div className="px-3 columns-2 md:columns-3 lg:columns-4 gap-3 pb-4">

        {feedPosts.map((post, i) => (

          <motion.div

            key={post.id}

            initial={{ opacity: 0, y: 20 }}

            animate={{ opacity: 1, y: 0 }}

            transition={{ delay: i * 0.05 }}

            className="break-inside-avoid mb-3"

          >

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl overflow-hidden shadow-sm shadow-pink-100/50">

              {/* Media */}

              {post.mediaUrl && (

                <div

                  className="w-full aspect-[3/4] bg-gradient-to-br from-pink-100 to-purple-100"

                  style={{

                    backgroundImage: `url(${post.mediaUrl})`,

                    backgroundSize: 'cover',

                    backgroundPosition: 'center',

                  }}

                />

              )}



              <div className="p-3">

                {/* Author */}

                <div className="flex items-center gap-2 mb-2">

                  <div

                    className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-200 to-purple-200 shrink-0"

                    style={{

                      backgroundImage: `url(${post.creatureAvatar})`,

                      backgroundSize: 'cover',

                    }}

                  />

                  <span className="text-xs font-medium text-gray-700">{post.creatureName}</span>

                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-pink-50 text-pink-400 border-0">

                    {post.emotion}

                  </Badge>

                </div>



                {/* Content */}

                <p className="text-sm text-gray-700 leading-relaxed mb-2 line-clamp-4">

                  {post.content}

                </p>



                {/* Tags */}

                <div className="flex gap-1 flex-wrap mb-2">

                  {post.tags.map((tag) => (

                    <span key={tag} className="text-[10px] text-purple-400">#{tag}</span>

                  ))}

                </div>



                {/* Actions */}

                <div className="flex items-center justify-between pt-2 border-t border-pink-50">

                  <button

                    onClick={() => toggleLike(post.id)}

                    className="flex items-center gap-1 min-h-[36px] px-1 cursor-pointer"

                  >

                    <Heart

                      className={`w-4 h-4 transition-colors duration-200 ${

                        liked.has(post.id) ? 'text-pink-500 fill-pink-500' : 'text-gray-400'

                      }`}

                    />

                    <span className="text-xs text-gray-400">

                      {post.likesCount + (liked.has(post.id) ? 1 : 0)}

                    </span>

                  </button>

                  <button className="flex items-center gap-1 min-h-[36px] px-1 cursor-pointer">

                    <MessageCircle className="w-4 h-4 text-gray-400" />

                    <span className="text-xs text-gray-400">{post.commentsCount}</span>

                  </button>

                  <button

                    onClick={() => setGiftTarget(post.id)}

                    className="flex items-center gap-1 min-h-[36px] px-1 cursor-pointer"

                  >

                    <Gift className="w-4 h-4 text-gray-400" />

                    <span className="text-xs text-gray-400">{post.giftsCount}</span>

                  </button>

                </div>

              </div>

            </div>

          </motion.div>

        ))}

      </div>



      {/* Gift modal */}

      <AnimatePresence>

        {giftTarget && (

          <motion.div

            className="fixed inset-0 z-50 flex items-end justify-center"

            initial={{ opacity: 0 }}

            animate={{ opacity: 1 }}

            exit={{ opacity: 0 }}

          >

            <div className="absolute inset-0 bg-black/30" onClick={() => setGiftTarget(null)} />

            <motion.div

              className="relative w-full md:max-w-lg md:mx-auto bg-white rounded-t-3xl md:rounded-3xl p-5 pb-8 md:mb-8"

              initial={{ y: '100%' }}

              animate={{ y: 0 }}

              exit={{ y: '100%' }}

              transition={{ type: 'spring', damping: 28, stiffness: 300 }}

            >

              <div className="flex items-center justify-between mb-4">

                <h3 className="text-base font-semibold text-gray-800">送礼物</h3>

                <button

                  onClick={() => setGiftTarget(null)}

                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer"

                  aria-label="关闭"

                >

                  <X className="w-5 h-5 text-gray-400" />

                </button>

              </div>

              <div className="flex gap-3">

                {giftOptions.map((gift) => (

                  <button

                    key={gift.name}

                    onClick={() => setGiftTarget(null)}

                    className="flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl bg-gray-50 hover:bg-pink-50 transition-colors duration-200 cursor-pointer"

                  >

                    <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${gift.color} shadow-lg`} />

                    <span className="text-sm font-medium text-gray-700">{gift.name}</span>

                    <span className="text-xs text-gray-400">{gift.price} 能量</span>

                  </button>

                ))}

              </div>

            </motion.div>

          </motion.div>

        )}

      </AnimatePresence>

    </div>

  );

}
