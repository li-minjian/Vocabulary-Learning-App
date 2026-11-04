import { useVocabularyVersion } from '../hooks/useVocabularyVersion';
import { Plus, Upload, RotateCcw, TrendingUp, Book, Target, FolderOpen, Clock } from 'lucide-react';
import { useNavigate } from "react-router";
import { useState, useEffect } from 'react';
import { fetchStats, fetchWords, fetchCollections, type VocabularyWord } from '../../lib/api';

function getRelativeTimeString(dateStr?: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return 'Recently';
  }
}

export function Dashboard() {
  const vocabularyVersion = useVocabularyVersion();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [recentWords, setRecentWords] = useState<VocabularyWord[]>([]);
  const [collectionCount, setCollectionCount] = useState<number>(0);

  useEffect(() => {
    let active = true;

    async function loadDashboardData() {
      try {
        setLoading(true);
        setError(null);

        const [statsData, wordsData, collectionsData] = await Promise.all([
          fetchStats(),
          fetchWords(),
          fetchCollections()
        ]);

        if (!active) return;

        setStats(statsData);
        setCollectionCount(collectionsData.length);
        


        // Sort words by created_at descending and get top 3
        const sorted = [...wordsData].sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });
        setRecentWords(sorted.slice(0, 3));

        setLoading(false);
      } catch (err: any) {
        if (!active) return;
        console.error("Failed to load dashboard data:", err);
        setError(err.message || "Failed to load dashboard statistics.");
        setLoading(false);
      }
    }

    loadDashboardData();
    return () => {
      active = false;
    };
  }, [vocabularyVersion]);

  if (loading) {
    return (
      <div className="p-8 space-y-6 animate-pulse bg-[#f8fafb] min-h-screen">
        <button onClick={()=>navigate('/learn')} className="rounded-xl bg-[#002434] px-5 py-3 font-bold text-white">Start Learning</button>
      {/* Title */}
        <div className="space-y-2 border-b border-[#c2c7cc]/50 pb-5">
          <div className="h-6 bg-slate-200 rounded w-1/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/3 mt-2"></div>
        </div>

        {/* Hero Card Skeleton */}
        <div className="h-44 bg-slate-200 rounded-3xl border border-[#c2c7cc]/50"></div>

        {/* Quick Actions Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="h-40 bg-slate-200 rounded-3xl border border-[#c2c7cc]/50"></div>
          <div className="h-40 bg-slate-200 rounded-3xl border border-[#c2c7cc]/50"></div>
          <div className="h-40 bg-slate-200 rounded-3xl border border-[#c2c7cc]/50"></div>
        </div>

        {/* Stats Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-24 bg-slate-200 rounded-2xl border border-[#c2c7cc]/50"></div>
          <div className="h-24 bg-slate-200 rounded-2xl border border-[#c2c7cc]/50"></div>
          <div className="h-24 bg-slate-200 rounded-2xl border border-[#c2c7cc]/50"></div>
          <div className="h-24 bg-slate-200 rounded-2xl border border-[#c2c7cc]/50"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 space-y-6 bg-[#f8fafb] min-h-screen text-[#191c1d]">
        <div className="border-b border-[#c2c7cc]/50 pb-5">
          <h1 className="text-[26px] font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-[#42474b] text-[13.5px] mt-1 font-semibold">Your learning overview</p>
        </div>
        <div className="bg-rose-50 text-rose-800 p-6 rounded-2xl border border-rose-200/50 space-y-3.5 shadow-sm max-w-lg">
          <h3 className="font-extrabold text-[15px]">Error Loading Dashboard</h3>
          <p className="text-[13px] font-semibold leading-relaxed">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="h-10 px-5 border border-rose-600 bg-white hover:bg-rose-50 text-rose-700 font-bold rounded-xl transition-all text-[13px] cursor-pointer select-none active:scale-95 shadow-sm"
          >
            Retry Loading
          </button>
        </div>
      </div>
    );
  }

  const dueCount = stats?.due_for_review || 0;
  const estimatedMin = Math.ceil(dueCount * 0.5);

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24">
      {/* Header Panel */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5">
        <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
          Learning Command Center
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">Dashboard</h1>
        <p className="text-[13.5px] text-[#42474b] font-semibold mt-2">Bring your words, learn smarter.</p>
      </div>

      {/* Hero Learning Status Card (Redesigned with soft grey canvas backgrounds) */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#002434]/5 border border-[#002434]/15 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-[#002434] select-none">
              <Clock className="w-3.5 h-3.5 text-[#002434]" strokeWidth={2.5} />
              <span>Scheduled review</span>
            </div>
            
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-[48px] font-extrabold tracking-tight leading-none text-[#002434] font-mono select-all">
                {dueCount}
              </span>
              <span className="text-[13px] text-[#42474b] font-bold uppercase tracking-wider">
                scheduled items due
              </span>
            </div>
            
            <p className="text-[13px] text-[#42474b] font-semibold leading-relaxed max-w-md">
              Vocabulary: {stats?.vocabulary_due || 0} due · Exercises: {stats?.exercise_due || 0} due · {stats?.vocabulary?.unscheduled || 0} unscheduled words available in Learn.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4.5">
            <div className="bg-[#f2f4f5] border border-[#c2c7cc]/60 rounded-2xl px-5 py-3.5 flex flex-col justify-center shadow-sm select-none">
              <span className="text-[#42474b] text-[10px] font-bold uppercase tracking-wider">Estimated Duration</span>
              <span className="text-[16px] font-mono font-bold text-[#191c1d] mt-1">{estimatedMin} minutes</span>
            </div>

            {dueCount > 0 ? (
              <button
                onClick={() => navigate('/learn?method=review')}
                className="h-11 px-6 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[13.5px] flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
              >
                <span>Start Review Session</span>
                <RotateCcw className="w-4 h-4 text-[#002434]" strokeWidth={2.5} />
              </button>
            ) : (
              <div className="text-emerald-800 text-[13px] font-bold bg-emerald-50 px-4 py-3 rounded-xl border border-emerald-100/50 flex items-center gap-1.5 shadow-sm select-none">
                ✨ No scheduled items due. Practice anytime in Learn.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions (Consistent borders, white surfaces, outline CTAs) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <button
          onClick={() => navigate('/vocabulary/new')}
          className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 flex flex-col justify-between hover:border-[#002434]/25 transition-all text-left group cursor-pointer shadow-sm hover:shadow-md duration-200"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform duration-200 text-[#002434]">
              <Plus className="w-5 h-5 text-[#002434]" strokeWidth={2.5} />
            </div>
            <h3 className="font-extrabold text-[15px] text-[#191c1d] mb-1 group-hover:text-[#002434] transition-colors tracking-tight">Add Single Word</h3>
            <p className="text-[13px] text-[#42474b] leading-relaxed font-semibold">Save a new word with custom translations and phonetics manually.</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/import')}
          className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 flex flex-col justify-between hover:border-[#002434]/25 transition-all text-left group cursor-pointer shadow-sm hover:shadow-md duration-200"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform duration-200 text-[#002434]">
              <Upload className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2.5} />
            </div>
            <h3 className="font-extrabold text-[15px] text-[#191c1d] mb-1 group-hover:text-[#002434] transition-colors tracking-tight">Import Pipeline</h3>
            <p className="text-[13px] text-[#42474b] leading-relaxed font-semibold">Paste full text documents, let AI extract candidates, and save them in bulk.</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/library?type=vocabulary')}
          className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 flex flex-col justify-between hover:border-[#002434]/25 transition-all text-left group cursor-pointer shadow-sm hover:shadow-md duration-200"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform duration-200 text-[#002434]">
              <Book className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2.5} />
            </div>
            <h3 className="font-extrabold text-[15px] text-[#191c1d] mb-1 group-hover:text-[#002434] transition-colors tracking-tight">Vocabulary Library</h3>
            <p className="text-[13px] text-[#42474b] leading-relaxed font-semibold">Browse, filter, edit, delete, and manage your personal repository library.</p>
          </div>
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Words */}
        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2.5 text-[#42474b] mb-3 select-none">
            <div className="w-7 h-7 rounded-lg bg-[#f2f4f5] flex items-center justify-center border border-[#c2c7cc]/50">
              <Book className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Words</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#002434] font-mono leading-none select-all">
            {stats?.total_words || 0}
          </div>
        </div>

        {/* Collections */}
        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2.5 text-[#42474b] mb-3 select-none">
            <div className="w-7 h-7 rounded-lg bg-[#f2f4f5] flex items-center justify-center border border-[#c2c7cc]/50">
              <FolderOpen className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Collections</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#002434] font-mono leading-none select-all">
            {collectionCount}
          </div>
        </div>

        {/* Mastered */}
        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2.5 text-[#42474b] mb-3 select-none">
            <div className="w-7 h-7 rounded-lg bg-[#f2f4f5] flex items-center justify-center border border-[#c2c7cc]/50">
              <Target className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mastered</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#002434] font-mono leading-none select-all">
            {stats?.mastered_words || 0}
          </div>
        </div>

        {/* Streak */}
        <div className="bg-white border border-[#c2c7cc]/60 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2.5 text-[#42474b] mb-3 select-none">
            <div className="w-7 h-7 rounded-lg bg-[#f2f4f5] flex items-center justify-center border border-[#c2c7cc]/50">
              <TrendingUp className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Study days · last 7</span>
          </div>
          <div className="text-[28px] font-extrabold text-[#002434] font-mono leading-none select-all">
            {stats?.weekly_activity?.filter((day: {reviews:number})=>day.reviews>0).length || 0} <span className="text-[13px] font-bold uppercase select-none">days</span>
          </div>
        </div>
      </div>

      {/* Recent Words */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-[#c2c7cc]/40 flex items-center justify-between">
          <h2 className="font-extrabold text-[15.5px] text-[#191c1d] tracking-tight">Recently Discovered Words</h2>
          <button 
            onClick={() => navigate('/library?type=vocabulary')}
            className="text-[13px] font-bold text-[#002434] hover:text-[#0a3346] hover:underline transition-colors cursor-pointer select-none"
          >
            View Library
          </button>
        </div>
        
        {recentWords.length > 0 ? (
          <div className="divide-y divide-[#c2c7cc]/40">
            {recentWords.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate('/vocabulary/' + item.id, { state: item })}
                className="w-full px-6 py-4.5 hover:bg-[#f2f4f5]/30 transition-all text-left flex items-center justify-between group cursor-pointer"
              >
                <div className="flex-1 space-y-1 min-w-0 pr-4">
                  <div className="font-bold text-[15px] text-[#191c1d] group-hover:text-[#002434] transition-colors flex items-center gap-2.5 flex-wrap">
                    <span className="truncate">{item.word}</span>
                    {item.ipa && (
                      <span className="text-[12px] font-mono text-[#002434]/70 bg-[#002434]/5 border border-[#002434]/10 px-1.5 py-0.5 rounded font-bold">
                        /{item.ipa.replace(/^\/|\/$/g, '')}/
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-[#42474b] font-semibold truncate">{item.translation}</div>
                </div>
                <div className="text-right space-y-1.5 shrink-0 flex flex-col items-end">
                  <span className="inline-flex items-center rounded-lg bg-[#eceeef] px-2.5 py-0.5 text-[10px] font-bold text-[#42474b] uppercase border border-[#c2c7cc]/50 select-none">
                    {item.language}
                  </span>
                  <div className="text-[11.5px] text-slate-450 font-bold">{getRelativeTimeString(item.created_at)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center space-y-5 bg-[#f8fafb]/20">
            <p className="text-[#42474b] text-[13.5px] font-semibold leading-relaxed">
              You haven't added any words yet. Start building your vocabulary repository!
            </p>
            <div className="flex flex-wrap justify-center gap-3 select-none">
              <button
                onClick={() => navigate('/vocabulary/new')}
                className="h-9 px-4 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] rounded-xl hover:bg-[#eceeef] hover:border-[#002434]/60 transition-all font-bold text-[12.5px] cursor-pointer active:scale-95 shadow-sm"
              >
                Add Your First Word
              </button>
              <button
                onClick={() => navigate('/import')}
                className="h-9 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] rounded-xl hover:bg-[#f2f4f5] transition-all font-bold text-[12.5px] cursor-pointer active:scale-95 shadow-sm"
              >
                Import Text
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
