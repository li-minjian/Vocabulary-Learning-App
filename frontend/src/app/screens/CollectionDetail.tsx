import { CollectionExercises } from '../components/CollectionExercises';
import { ArrowLeft, Plus, Trash2, MoreVertical, Clock, Loader2, FolderOpen, Volume2 } from 'lucide-react';
import { useNavigate, useParams, useLocation } from "react-router";
import { useEffect, useState } from 'react';
import { fetchWordsByCollection, fetchCollectionById, deleteCollection, type VocabularyWord } from '../../lib/api';
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

export function CollectionDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: collectionId } = useParams<{ id: string }>();
  const data = location.state;

  const [collection, setCollection] = useState(data || { name: '...', description: '' });

  const [words, setWords] = useState<VocabularyWord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state for deletion
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteClick = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!collectionId) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteCollection(collectionId);
      setIsDeleteDialogOpen(false);
      navigate('/collections');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete collection');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    if (!collectionId) {
      setError('No collection ID provided');
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const loadWords = async () => {
      try {
        const [items, details] = await Promise.all([fetchWordsByCollection(collectionId), fetchCollectionById(collectionId)]);
        if (!isMounted) return;
        setWords(items);
        setCollection(details);
        setError(null);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load words');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadWords();

    return () => {
      isMounted = false;
    };
  }, [collectionId]);

  const masteredCount = words.filter(w => w.mastery === 'Mastered').length;
  const learningCount = words.filter(w => w.mastery === 'Learning').length;
  const familiarCount = words.filter(w => w.mastery === 'Familiar').length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24 min-h-screen">
      {/* Back button & Control */}
      <div>
        <button
          onClick={() => navigate('/collections')}
          className="h-9 px-3.5 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13px] inline-flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 transition-all select-none mb-3"
        >
          <ArrowLeft className="w-4 h-4 text-[#42474b]" strokeWidth={2.5} />
          <span>Back to Collections</span>
        </button>
      </div>

      {/* Header Panel Card */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex items-start gap-4.5">
            <div className="w-14 h-14 rounded-2xl bg-[#002434]/5 border border-[#002434]/10 flex items-center justify-center flex-shrink-0 select-none">
              <FolderOpen className="w-7 h-7 text-[#002434]" strokeWidth={1.5} />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none leading-none">
                Collection Folder
              </div>
              <h1 className="text-[26px] font-extrabold tracking-tight text-[#002434] leading-none mt-1.5 truncate">
                {collection.name}
              </h1>
              {collection.description && (
                <p className="text-[13.5px] text-[#42474b] leading-relaxed font-semibold pt-1 max-w-2xl">{collection.description}</p>
              )}
              <p className="text-slate-450 text-[12.5px] font-bold pt-1 select-none">
                {isLoading ? 'Scanning collection terms...' : `${words.length} vocabulary terms`}
              </p>
            </div>
          </div>

          <div className="flex gap-3 shrink-0">
            <button 
              onClick={() => navigate('/vocabulary/new', { state: { collectionName: collection.name } })}
              className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[13px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
              title="Add words inside this collection"
            >
              <Plus className="w-4 h-4 text-[#002434]" strokeWidth={2.5} />
              <span>Add Words</span>
            </button>
            <button 
              onClick={handleDeleteClick}
              disabled={isDeleting || isLoading}
              className="h-10 px-4 bg-rose-50 border border-rose-200 hover:bg-rose-100/70 text-rose-700 rounded-xl font-bold text-[13px] flex items-center gap-2 cursor-pointer select-none active:scale-95 shadow-sm disabled:opacity-50"
              title="Delete Collection Folder"
            >
              <Trash2 className="w-4 h-4 text-rose-700" strokeWidth={2.5} />
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#c2c7cc]/30 select-none">
          <div className="bg-[#f2f4f5]/30 border border-[#c2c7cc]/50 rounded-xl p-4 flex flex-col justify-between">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Total Words</div>
            <div className="text-[24px] font-mono font-extrabold text-[#002434] leading-none">{isLoading ? '—' : words.length}</div>
          </div>
          <div className="bg-[#f2f4f5]/30 border border-[#c2c7cc]/50 rounded-xl p-4 flex flex-col justify-between">
            <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mb-2">Mastered</div>
            <div className="text-[24px] font-mono font-extrabold text-emerald-650 leading-none">{isLoading ? '—' : masteredCount}</div>
          </div>
          <div className="bg-[#f2f4f5]/30 border border-[#c2c7cc]/50 rounded-xl p-4 flex flex-col justify-between">
            <div className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-2">Familiar</div>
            <div className="text-[24px] font-mono font-extrabold text-blue-650 leading-none">{isLoading ? '—' : familiarCount}</div>
          </div>
          <div className="bg-[#f2f4f5]/30 border border-[#c2c7cc]/50 rounded-xl p-4 flex flex-col justify-between">
            <div className="text-[10px] text-orange-600 font-bold uppercase tracking-wider mb-2">Learning</div>
            <div className="text-[24px] font-mono font-extrabold text-orange-650 leading-none">{isLoading ? '—' : learningCount}</div>
          </div>
        </div>
      </div>

      {collectionId&&<CollectionExercises collectionId={collectionId}/>}
      <div className="flex items-center justify-between gap-4 pt-2">
        <h2 className="font-extrabold text-[16.5px] text-[#002434] tracking-tight">Words in Collection Folder</h2>
        <button
          onClick={() => navigate('/vocabulary/new', { state: { collectionName: collection.name } })}
          className="h-9 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[12.5px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none"
        >
          <Plus className="w-4 h-4 text-[#002434]" strokeWidth={2.5} />
          <span>Add Words</span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-[13.5px] text-rose-800 space-y-2">
          <div className="font-extrabold text-[15px]">Failed to scan collection words</div>
          <div className="text-[13.2px] text-rose-700 font-semibold leading-relaxed">
            {error}
          </div>
        </div>
      )}

      {/* Library Table Card */}
      <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-[#f8fafb] border-b border-[#c2c7cc]/40">
              <tr>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Word
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Translation
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Mastery
                </th>
                <th className="text-left px-6 py-4 text-[10px] font-bold text-[#42474b] uppercase tracking-wider select-none">
                  Next Review
                </th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#c2c7cc]/30">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#002434]" strokeWidth={2} />
                    <p className="text-[13.5px] text-[#42474b] mt-2 font-semibold select-none">Scanning collection vocabulary...</p>
                  </td>
                </tr>
              ) : words.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center select-none bg-[#f8fafb]/10">
                    <p className="text-[#42474b] text-[13.5px] font-semibold leading-relaxed">
                      No words stored in this collection folder yet.
                    </p>
                    <button
                      onClick={() => navigate('/vocabulary/new', { state: { collectionName: collection.name } })}
                      className="h-8.5 px-4 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] rounded-xl hover:bg-[#eceeef] transition-all font-bold text-[12px] mt-4 shadow-sm"
                    >
                      Add Your First Word
                    </button>
                  </td>
                </tr>
              ) : (
                words.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate('/vocabulary/' + item.id, { state: item })}
                    className="hover:bg-[#f2f4f5]/30 cursor-pointer transition-all group duration-150"
                  >
                    <td className="px-6 py-4.5">
                      <div className="flex items-center gap-2.5">
                        <span className="font-extrabold text-[15px] text-[#191c1d] group-hover:text-[#002434] transition-colors">{item.word}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            speakWord(item.word, item.language);
                          }}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-xl bg-[#002434]/5 border border-[#002434]/10 hover:bg-[#002434]/10 text-[#002434] transition-all"
                          title="Pronounce"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-[#002434]" strokeWidth={2} />
                        </button>
                      </div>
                      {item.pos && (
                        <div className="text-[12.5px] text-[#42474b] mt-1 font-semibold select-none">{item.pos}</div>
                      )}
                    </td>
                    <td className="px-6 py-4.5 text-[14px] font-semibold text-[#191c1d]">
                      {item.translation}
                    </td>
                    <td className="px-6 py-4.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider border ${
                          item.mastery === 'Mastered'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                            : item.mastery === 'Familiar'
                            ? 'bg-blue-50 text-blue-700 border-blue-200/50'
                            : 'bg-orange-50 text-orange-700 border-orange-200/50'
                        }`}
                      >
                        {item.mastery || 'New'}
                      </span>
                    </td>
                    <td className="px-6 py-4.5">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#42474b] select-none">
                        <Clock className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
                        <span>{item.nextReview || 'Not scheduled'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('/vocabulary/' + item.id, { state: { ...item, isDirectEditing: true } });
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#f2f4f5] border border-transparent hover:border-[#c2c7cc]/50 cursor-pointer text-[#42474b] hover:text-[#002434]"
                        title="Edit Word"
                      >
                        <MoreVertical className="w-4 h-4" strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 shadow-xl max-w-[440px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-extrabold text-[#002434] tracking-tight">Delete Collection</AlertDialogTitle>
            <AlertDialogDescription className="text-[13.5px] text-[#42474b] font-semibold leading-relaxed">
              {words.length > 0 ? (
                <div className="space-y-4">
                  <div>
                    The collection folder <strong className="font-bold text-[#002434]">"{collection.name}"</strong> currently contains <strong className="font-bold text-[#002434]">{words.length} vocabulary words</strong>.
                  </div>
                  <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3.5 text-[13px] leading-relaxed">
                    To safeguard your study metrics, you must move or remove the associated words from this collection before deleting it.
                  </div>
                </div>
              ) : (
                <>
                  Are you sure you want to permanently delete <strong className="font-bold text-[#002434]">"{collection.name}"</strong>? This will delete the empty collection envelope and cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {deleteError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-bold text-rose-800 animate-in fade-in-50 duration-200">
              {deleteError}
            </div>
          )}

          <AlertDialogFooter className="border-t border-[#c2c7cc]/40 pt-3.5 mt-4">
            {words.length > 0 ? (
              <button
                onClick={() => setIsDeleteDialogOpen(false)}
                className="h-10 px-5 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] text-[#002434] font-bold rounded-xl text-[13.5px] cursor-pointer shadow-sm active:scale-95 select-none"
              >
                Acknowledge
              </button>
            ) : (
              <>
                <AlertDialogCancel disabled={isDeleting} onClick={() => setIsDeleteDialogOpen(false)} className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] hover:bg-[#f2f4f5] rounded-xl font-bold text-[13px] cursor-pointer select-none active:scale-95 shadow-sm transition-all">
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
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
