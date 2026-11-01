import { TrendingUp, Calendar, Target, Clock } from 'lucide-react';
import { useNavigate, useLocation } from "react-router";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useState, useEffect } from 'react';
import { fetchStats } from '../../lib/api';
import { TypingProgressSummary } from '../components/TypingProgressSummary';

export function Statistics() {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state;
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch stats", err);
        setError(err.message || 'Failed to load statistics');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex justify-center items-center h-full">
        <p className="text-muted-foreground">Loading statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 text-destructive p-4 rounded-lg border border-destructive/20">
          {error}
        </div>
      </div>
    );
  }

  const { 
    total_words, 
    mastered_words, 
    added_this_week, 
    due_for_review, 
    study_hours, 
    languages, 
    weekly_activity, 
    progress_data,
    accuracy_rate
  } = stats || {};

  const masteryPercentage = total_words > 0 ? Math.round((mastered_words / total_words) * 100) : 0;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24 min-h-screen">
      {/* Header Panel */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5">
        <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
          Learning Statistics
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">Statistics</h1>
        <p className="text-[13.5px] text-[#42474b] font-semibold mt-2">Track your vocabulary progress, mastery ratios, and SRS activity.</p>
      </div>

      {/* Key Metrics */}
      <TypingProgressSummary />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-[#42474b] mb-3">
            <Target className="w-4 h-4 text-[#42474b]" strokeWidth={1.5} />
            <span className="text-[13px] font-bold">Total Words</span>
          </div>
          <div className="text-[32px] font-extrabold text-[#191c1d] mb-1 font-mono">{total_words}</div>
          <div className="text-[13px] text-emerald-600 flex items-center gap-1 font-bold">
            <TrendingUp className="w-3 h-3 text-emerald-600" strokeWidth={2.5} />
            +{added_this_week} this week
          </div>
        </div>

        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-[#42474b] mb-3">
            <Target className="w-4 h-4 text-[#42474b]" strokeWidth={1.5} />
            <span className="text-[13px] font-bold">Mastered</span>
          </div>
          <div className="text-[32px] font-extrabold text-[#191c1d] mb-1 font-mono">{mastered_words}</div>
          <div className="text-[13px] text-[#42474b] font-bold">{masteryPercentage}% of total</div>
        </div>

        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-[#42474b] mb-3">
            <Calendar className="w-4 h-4 text-[#42474b]" strokeWidth={1.5} />
            <span className="text-[13px] font-bold">Due For Review</span>
          </div>
          <div className="text-[32px] font-extrabold text-[#191c1d] mb-1 font-mono">{due_for_review}</div>
          <div className="text-[13px] text-[#42474b] font-bold">words waiting</div>
        </div>

        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-[#42474b] mb-3">
            <Clock className="w-4 h-4 text-[#42474b]" strokeWidth={1.5} />
            <span className="text-[13px] font-bold">Total Study Time</span>
          </div>
          <div className="text-[32px] font-extrabold text-[#191c1d] mb-1 font-mono">{study_hours}h</div>
          <div className="text-[13px] text-[#42474b] font-bold">estimated</div>
        </div>
      </div>

      {/* Weekly Activity */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
        <h2 className="font-bold text-[15px] text-[#191c1d] mb-6">Weekly Review Activity</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={weekly_activity || []} margin={{ top: 10, right: 10, left: -20, bottom: 15 }}>
            <XAxis dataKey="day" stroke="#a3a3a3" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#a3a3a3" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #c2c7cc',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 'bold',
              }}
            />
            <Bar dataKey="reviews" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Progress Over Time */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
        <h2 className="font-bold text-[15px] text-[#191c1d] mb-6">Mastered Words Progress</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={progress_data || []} margin={{ top: 10, right: 15, left: -20, bottom: 15 }}>
            <XAxis dataKey="month" stroke="#a3a3a3" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#a3a3a3" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #c2c7cc',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 'bold',
              }}
            />
            <Line type="monotone" dataKey="mastered" stroke="#059669" strokeWidth={2.5} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Language Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
          <h2 className="font-bold text-[15px] text-[#191c1d] mb-4">By Language</h2>
          <div className="space-y-4">
            {(!languages || languages.length === 0) ? (
              <div className="text-[#42474b] text-[13px] font-semibold">No languages recorded.</div>
            ) : (
              languages.slice(0, 3).map((lang: any, index: number) => {
                const colors = ['bg-emerald-500', 'bg-emerald-600', 'bg-emerald-400'];
                const percent = total_words > 0 ? Math.round((lang.count / total_words) * 100) : 0;
                return (
                  <div key={lang.name}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[14px] font-bold text-[#191c1d]">{lang.name}</span>
                      <span className="text-[13.5px] font-bold text-[#42474b]">{lang.count} words</span>
                    </div>
                    <div className="h-2 bg-[#f2f4f5] rounded-full overflow-hidden">
                      <div className={`h-full ${colors[index % colors.length]}`} style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm">
          <h2 className="font-bold text-[15px] text-[#191c1d] mb-4">Accuracy Rate</h2>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-bold text-[#191c1d]">This Week</span>
                <span className="text-[13.5px] font-bold text-[#42474b]">87%</span>
              </div>
              <div className="h-2 bg-[#f2f4f5] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: '87%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-bold text-[#191c1d]">Last Week</span>
                <span className="text-[13.5px] font-bold text-[#42474b]">83%</span>
              </div>
              <div className="h-2 bg-[#f2f4f5] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: '83%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-bold text-[#191c1d]">All Time</span>
                <span className="text-[13.5px] font-bold text-[#42474b]">85%</span>
              </div>
              <div className="h-2 bg-[#f2f4f5] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: '85%' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
