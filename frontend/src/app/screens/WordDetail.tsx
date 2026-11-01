import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useParams } from "react-router";
import { ArrowLeft, Edit2, Trash2, Tag, FolderOpen, Clock, TrendingUp, Loader2, Volume2 } from 'lucide-react';
import { fetchWordById, updateWord, deleteWord, type VocabularyWord } from '../../lib/api';
import { speakWord } from '../../lib/speech';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../components/ui/alert-dialog';

export function WordDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state;
  const { id } = useParams<{ id: string }>();
  const wordId = id || data?.id;
  
  const initialWord: VocabularyWord = {
    id: wordId ?? '',
    word: '...',
    ipa: '',
    translation: '...',
    pos: 'Noun',
    language: 'English',
    tags: [],
    nextReview: 'Today',
    mastery: 'Learning',
    definition: '',
    examples: [],
    collocations: [],
    synonyms: [],
    relatedWords: [],
    collection: '',
    source: '',
    addedAt: '',
    reviewCount: 0,
  };

  const [word, setWord] = useState<VocabularyWord>({ ...initialWord, ...data });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(wordId));
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<VocabularyWord>>({});
  const [isSaving, setIsSaving] = useState(false);

  // AlertDialog state for deletion
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!wordId) {
      setWord((current) => ({ ...current, ...data }));
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const loadWord = async () => {
      try {
        const result = await fetchWordById(wordId);
        if (!isMounted) return;
        
        // Ensure defaults for arrays to prevent mapping errors
        const safeResult = {
          ...result,
          tags: Array.isArray(result.tags) ? result.tags : [],
          examples: Array.isArray(result.examples) ? result.examples : [],
          collocations: Array.isArray(result.collocations) ? result.collocations : [],
          synonyms: Array.isArray(result.synonyms) ? result.synonyms : [],
          relatedWords: Array.isArray(result.relatedWords) ? result.relatedWords : [],
        };
        
        setWord(safeResult);
        setLoadError(null);

        // Auto-enter edit mode if navigating from Edit menu
        if (data?.isDirectEditing) {
          setEditForm({
            word: safeResult.word,
            ipa: safeResult.ipa || '',
            translation: safeResult.translation,
            pos: safeResult.pos,
            language: safeResult.language,
            definition: safeResult.definition
          });
          setIsEditing(true);
        }
      } catch (error) {
        if (!isMounted) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load word details');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadWord();

    return () => {
      isMounted = false;
    };
  }, [data, wordId]);

  const handleDeleteClick = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!word.id) return;
    setIsDeleting(true);
    setLoadError(null);
    try {
      await deleteWord(word.id);
      setIsDeleteDialogOpen(false);
      navigate('/vocabulary');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete word');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditClick = () => {
    setEditForm({
      word: word.word,
      ipa: word.ipa || '',
      translation: word.translation,
      pos: word.pos,
      language: word.language,
      definition: word.definition
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!word.id) return;
    setIsSaving(true);
    setLoadError(null);
    try {
      await updateWord(word.id, editForm);
      setWord(prev => ({ ...prev, ...editForm }));
      setIsEditing(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to update word');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24 min-h-screen">
      {/* Header Back & Action Control */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/vocabulary')}
            className="h-9 px-3.5 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13px] inline-flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 transition-all select-none mb-3"
          >
            <ArrowLeft className="w-4 h-4 text-[#42474b]" strokeWidth={2.5} />
            <span>Back to Library</span>
          </button>
          <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
            Dictionary Repository Card
          </div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">Word Detail</h1>
          <p className="text-[13.5px] text-[#42474b] font-semibold mt-2">Spaced learning metadata entry properties & AI details.</p>
        </div>

        {/* Action controls */}
        <div className="flex gap-3">
          {isEditing ? (
            <>
              <button 
                onClick={() => setIsEditing(false)}
                className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13px] cursor-pointer select-none active:scale-95 transition-all shadow-sm"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[13px] flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-[#002434]" strokeWidth={2.5} /> : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={handleEditClick} 
                className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[13px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
              >
                <Edit2 className="w-4 h-4 text-[#002434]" strokeWidth={2.5} />
                <span>Edit Word</span>
              </button>
              <button 
                onClick={handleDeleteClick}
                disabled={isDeleting}
                className="h-10 px-4 bg-rose-50 border border-rose-200 hover:bg-rose-100/70 text-rose-700 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 cursor-pointer select-none active:scale-95 shadow-sm disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin text-rose-700" strokeWidth={2.5} /> : <Trash2 className="w-4 h-4 text-rose-700" strokeWidth={2.5} />}
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {(isLoading || loadError) && (
        <div
          className={`rounded-2xl border p-5 text-[13.5px] ${
            loadError
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-[#c2c7cc]/50 bg-white text-[#42474b] animate-pulse font-semibold'
          }`}
        >
          {loadError ? (
            <div className="space-y-1">
              <div className="font-extrabold">Failed to load word details</div>
              <div className="text-[13px] text-rose-700 font-semibold">{loadError}</div>
            </div>
          ) : (
            'Loading word entries from Flask REST API database...'
          )}
        </div>
      )}

      {/* Main 2-Column Split Layout */}
      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column (60% width span 2) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-8 shadow-sm space-y-6">
              {/* Word Header details */}
              <div className="space-y-4">
                {isEditing ? (
                  <div className="space-y-4 pt-2">
                    <div>
                      <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider mb-1.5">Word *</label>
                      <input 
                        type="text"
                        value={editForm.word || ''}
                        onChange={e => setEditForm({ ...editForm, word: e.target.value })}
                        className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                        placeholder="Word"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider mb-1.5">IPA Phonetic Key</label>
                      <input 
                        type="text"
                        value={editForm.ipa || ''}
                        onChange={e => setEditForm({ ...editForm, ipa: e.target.value })}
                        className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13.5px] font-mono text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                        placeholder="e.g. /ˈtrɪɡər/"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider mb-1.5">Part of Speech</label>
                        <select 
                          value={editForm.pos || ''}
                          onChange={e => setEditForm({ ...editForm, pos: e.target.value })}
                          className="w-full h-10 px-3 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13.5px] font-semibold text-[#191c1d] focus:outline-none focus:bg-white transition-all duration-200 cursor-pointer"
                        >
                          <option>Noun</option>
                          <option>Verb</option>
                          <option>Adjective</option>
                          <option>Adverb</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider mb-1.5">Language</label>
                        <select 
                          value={editForm.language || ''}
                          onChange={e => setEditForm({ ...editForm, language: e.target.value })}
                          className="w-full h-10 px-3 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13.5px] font-semibold text-[#191c1d] focus:outline-none focus:bg-white transition-all duration-200 cursor-pointer"
                        >
                          <option>English</option>
                          <option>German</option>
                          <option>French</option>
                          <option>Spanish</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider mb-1.5">Translation / Primary Meaning</label>
                      <input 
                        type="text"
                        value={editForm.translation || ''}
                        onChange={e => setEditForm({ ...editForm, translation: e.target.value })}
                        className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                        placeholder="Meaning"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3.5 flex-wrap">
                      <h2 className="text-[36px] font-extrabold tracking-tight text-[#002434] leading-none">{word.word}</h2>
                      <button
                        onClick={() => speakWord(word.word, word.language)}
                        className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-[#002434]/5 border border-[#002434]/10 hover:bg-[#002434]/10 text-[#002434] transition-all cursor-pointer shadow-sm active:scale-95"
                        title="Pronounce Word"
                      >
                        <Volume2 className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2.5} />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {word.ipa && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#002434]/5 border border-[#002434]/10 rounded-lg font-mono text-[12px] font-bold text-[#002434] select-all">
                          /{word.ipa.replace(/^\/|\/$/g, '')}/
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 bg-[#eceeef] border border-[#c2c7cc]/50 rounded-lg text-[10.5px] font-bold uppercase tracking-wider text-[#42474b] select-none">
                        {word.pos || 'Unknown'}
                      </span>
                      <span className="px-2.5 py-0.5 bg-[#eceeef] border border-[#c2c7cc]/50 rounded-lg text-[10.5px] font-bold uppercase tracking-wider text-[#42474b] select-none">
                        {word.language}
                      </span>
                    </div>

                    <div className="text-[17px] font-extrabold text-[#002434] bg-[#f2f4f5] px-4 py-3 rounded-2xl border border-[#c2c7cc]/30 max-w-xl select-all mt-3.5">
                      <span className="text-[11px] block font-bold uppercase tracking-wider text-slate-400 mb-1 select-none font-sans">Translation</span>
                      {word.translation}
                    </div>
                  </>
                )}
              </div>

              {/* Core dictionary details */}
              <div className="space-y-6 pt-5 border-t border-[#c2c7cc]/40">
                {isEditing ? (
                  <div className="space-y-2">
                    <label className="block text-[11px] text-[#42474b] font-bold uppercase tracking-wider mb-1">Dictionary Definition</label>
                    <textarea 
                      value={editForm.definition || ''}
                      onChange={e => setEditForm({ ...editForm, definition: e.target.value })}
                      className="w-full bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl p-3.5 text-[13.5px] leading-relaxed focus:outline-none focus:bg-white transition-all duration-200 min-h-[100px] text-[#191c1d] font-semibold resize-none placeholder:text-[#42474b]/50"
                      placeholder="Enter core dictionary definition..."
                    />
                  </div>
                ) : word.definition ? (
                  <div className="space-y-2 select-all">
                    <h3 className="text-[10px] font-bold text-[#42474b]/80 uppercase tracking-wider select-none">Definition</h3>
                    <p className="text-[14.5px] leading-relaxed text-[#191c1d] font-semibold max-w-3xl">{word.definition}</p>
                  </div>
                ) : null}

                {/* Example Sentences */}
                {word.examples && word.examples.length > 0 && (
                  <div className="space-y-3.5 select-all">
                    <h3 className="text-[10px] font-bold text-[#42474b]/80 uppercase tracking-wider select-none">Example Sentences</h3>
                    <div className="space-y-4">
                      {word.examples.map((example, index) => (
                        <div key={index} className="pl-4.5 border-l-[3px] border-[#002434]/30 space-y-1">
                          <div className="text-[15px] leading-relaxed font-bold text-[#191c1d]">{example.sentence}</div>
                          {example.translation && (
                            <div className="text-[13px] text-[#42474b] font-semibold">{example.translation}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Linguistic Collocations chips */}
                {word.collocations && word.collocations.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="text-[10px] font-bold text-[#42474b]/80 uppercase tracking-wider select-none">Common Collocations</h3>
                    <div className="flex flex-wrap gap-2">
                      {word.collocations.map((item, i) => (
                        <span 
                          key={i} 
                          className="px-3 py-1.5 bg-[#002434]/5 border border-[#002434]/10 rounded-xl text-[12.5px] font-bold text-[#002434]"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Synonyms & Relatives */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                  {word.synonyms && word.synonyms.length > 0 && (
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] font-bold text-[#42474b]/80 uppercase tracking-wider select-none">Synonyms</h3>
                      <div className="flex flex-wrap gap-2">
                        {word.synonyms.map((item, i) => (
                          <span 
                            key={i} 
                            className="px-3 py-1.5 bg-[#002434]/5 border border-[#002434]/10 rounded-xl text-[12.5px] font-bold text-[#002434]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {word.relatedWords && word.relatedWords.length > 0 && (
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] font-bold text-[#42474b]/80 uppercase tracking-wider select-none">Related Words</h3>
                      <div className="flex flex-wrap gap-2">
                        {word.relatedWords.map((item, i) => (
                          <span 
                            key={i} 
                            className="px-3 py-1.5 bg-[#002434]/5 border border-[#002434]/10 rounded-xl text-[12.5px] font-bold text-[#002434]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (40% width / Span 1) */}
          <div className="space-y-6">
            {/* Spaced Learning Progression Card */}
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm space-y-4">
              <h3 className="font-extrabold text-[15px] text-[#002434] tracking-tight">Learning Performance</h3>
              <div className="space-y-4.5 pt-1">
                <div>
                  <div className="flex items-center justify-between text-[12.5px] font-bold text-[#42474b] mb-2 select-none">
                    <span>Mastery Level</span>
                    <span className="text-[#002434]">{word.mastery || 'Learning'}</span>
                  </div>
                  <div className="h-2 bg-[#f2f4f5] border border-[#c2c7cc]/20 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        word.mastery === 'Mastered'
                          ? 'bg-emerald-500 w-full'
                          : word.mastery === 'Familiar'
                          ? 'bg-blue-500 w-2/3'
                          : 'bg-orange-500 w-1/3'
                      }`}
                    ></div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-3.5 border-t border-[#c2c7cc]/40 select-none">
                  <div className="w-8 h-8 rounded-xl bg-[#f2f4f5] border border-[#c2c7cc]/40 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-slate-550" strokeWidth={2} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">Next Scheduled Review</div>
                    <div className="text-[13px] font-extrabold text-[#002434] mt-0.5">{word.nextReview || 'Not scheduled'}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 select-none">
                  <div className="w-8 h-8 rounded-xl bg-[#f2f4f5] border border-[#c2c7cc]/40 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-slate-550" strokeWidth={2} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">Total Review Count</div>
                    <div className="text-[13px] font-extrabold text-[#002434] mt-0.5">{word.reviewCount || 0} recalls</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Folder / Tags Organization Card */}
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm space-y-4 select-none">
              <h3 className="font-extrabold text-[15px] text-[#002434] tracking-tight">Organization</h3>
              <div className="space-y-4 pt-1">
                {word.collection && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-2">
                      <FolderOpen className="w-3.5 h-3.5 text-slate-400" strokeWidth={2} />
                      Collection Folder
                    </div>
                    <div className="px-3.5 py-2 bg-[#f2f4f5] border border-[#c2c7cc]/50 rounded-xl text-[13px] font-bold text-[#42474b]">
                      {word.collection}
                    </div>
                  </div>
                )}

                {word.tags && word.tags.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-2">
                      <Tag className="w-3.5 h-3.5 text-slate-400" strokeWidth={2} />
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(word.tags || []).map((tag, i) => (
                        <span 
                          key={i} 
                          className="px-2.5 py-0.5 bg-[#002434]/5 border border-[#002434]/10 rounded-lg text-[11px] font-bold text-[#002434]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Origins Card */}
            <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-sm space-y-4 select-none">
              <h3 className="font-extrabold text-[15px] text-[#002434] tracking-tight">Origin</h3>
              <div className="pt-1 space-y-3.5 text-[13px] font-bold text-[#42474b]">
                <div>
                  <span className="text-slate-450 block text-[10px] uppercase tracking-wider mb-0.5">Source Material</span>
                  <span className="text-[13px] text-[#002434] font-extrabold">{word.source || 'Manual input'}</span>
                </div>
                {word.addedAt && (
                  <div>
                    <span className="text-slate-450 block text-[10px] uppercase tracking-wider mb-0.5">Created At</span>
                    <span className="text-[13px] text-[#002434] font-extrabold">
                      {new Date(word.addedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AlertDialog Delete Confirmation */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-extrabold text-[#191c1d] tracking-tight">Delete Word</AlertDialogTitle>
            <AlertDialogDescription className="text-[13.5px] text-[#42474b] font-semibold leading-relaxed">
              Are you sure you want to delete the word <strong className="font-bold text-[#002434]">"{word.word}"</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <AlertDialogFooter className="gap-3 mt-4">
            <AlertDialogCancel 
              disabled={isDeleting} 
              onClick={() => setIsDeleteDialogOpen(false)} 
              className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13px] cursor-pointer select-none active:scale-95 shadow-sm transition-all"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirm();
              }}
              className="h-10 px-5 bg-rose-50 border border-rose-200 hover:bg-rose-100/70 text-rose-700 rounded-xl font-bold text-[13px] cursor-pointer flex items-center justify-center gap-2 select-none active:scale-95 shadow-sm transition-all"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin text-rose-700" strokeWidth={2.5} /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
