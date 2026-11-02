import { useVocabularyVersion } from '../hooks/useVocabularyVersion';
import { Plus, FolderOpen, Book, Loader2 } from 'lucide-react';
import { useNavigate } from "react-router";
import { useEffect, useState } from 'react';
import { fetchCollections, createCollection, type Collection } from '../../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '../components/ui/dialog';

export function CollectionsHub() {
  const vocabularyVersion = useVocabularyVersion();
  const navigate = useNavigate();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Modal states for creating collections
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDesc, setNewCollectionDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const loadCollections = async () => {
    setIsLoading(true);
    try {
      const data = await fetchCollections();
      setCollections(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collections');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCollections();
  }, [vocabularyVersion]);

  const handleCreate = () => {
    setNewCollectionName('');
    setNewCollectionDesc('');
    setCreateError(null);
    setIsDialogOpen(true);
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) {
      setCreateError('Collection name is required');
      return;
    }
    
    setIsCreating(true);
    setCreateError(null);
    try {
      await createCollection({
        name: newCollectionName.trim(),
        description: newCollectionDesc.trim()
      });
      await loadCollections();
      setIsDialogOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create collection');
    } finally {
      setIsCreating(false);
    }
  };

  // Premium, highly subtle pastel colors for folder icon trays
  const getColor = (str: string) => {
    const textColors = [
      'text-teal-700 bg-teal-50 border border-teal-200/50',
      'text-blue-700 bg-blue-50 border border-blue-200/50',
      'text-indigo-700 bg-indigo-50 border border-indigo-200/50',
      'text-violet-700 bg-violet-50 border border-violet-200/50',
      'text-emerald-700 bg-emerald-50 border border-emerald-200/50',
      'text-rose-700 bg-rose-50 border border-rose-200/50',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return textColors[Math.abs(hash) % textColors.length];
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-[#f8fafb] animate-in fade-in-50 duration-200 text-[#191c1d] pb-24 min-h-screen">
      {/* Header Panel */}
      <div className="shrink-0 border-b border-[#c2c7cc]/50 pb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[#42474b] font-bold tracking-wider text-[10px] uppercase select-none">
            Topic Folders
          </div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#191c1d] leading-none mt-1">Collections Hub</h1>
          <p className="text-[13.5px] text-[#42474b] font-semibold mt-2">Organize and structure vocabulary words by customized study topics.</p>
        </div>
        <button 
          onClick={handleCreate}
          disabled={isCreating}
          className="h-10 px-4 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] hover:border-[#002434]/60 text-[#002434] rounded-xl transition-all font-bold text-[13px] flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 select-none disabled:opacity-50"
        >
          {isCreating ? <Loader2 className="w-4 h-4 animate-spin text-[#002434]" strokeWidth={2.5} /> : <Plus className="w-4.5 h-4.5 text-[#002434]" strokeWidth={2.5} />}
          <span>New Collection</span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-[13.5px] text-rose-800 space-y-2">
          <div className="font-extrabold text-[15px]">Failed to fetch collections</div>
          <div className="text-[13.2px] text-rose-700 font-semibold leading-relaxed">
            {error}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 text-[#42474b] space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#002434]" strokeWidth={2} />
          <span className="text-[14px] font-semibold select-none">Fetching vocabulary collections from local Flask API...</span>
        </div>
      ) : collections.length === 0 ? (
        <div className="text-center py-20 bg-white border border-[#c2c7cc]/60 border-dashed rounded-3xl shadow-sm space-y-4 max-w-2xl mx-auto select-none">
          <FolderOpen className="w-12 h-12 mx-auto text-slate-400 mb-4 animate-pulse" strokeWidth={1.5} />
          <h3 className="text-[17px] font-extrabold text-[#002434] tracking-tight">No collections found</h3>
          <p className="text-[13.5px] text-[#42474b] max-w-sm mx-auto leading-relaxed font-semibold">
            Create your first vocabulary collection to cluster terms, organize files, and review queues.
          </p>
          <button 
            onClick={handleCreate}
            className="h-9 px-4.5 bg-[#f2f4f5] border border-[#002434]/40 hover:bg-[#eceeef] text-[#002434] font-bold rounded-xl transition-all text-[12.5px] cursor-pointer shadow-sm"
          >
            Create Your First Collection
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Main Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {collections.map((collection) => (
              <button
                key={collection.id}
                onClick={() => navigate(`/collections/${collection.id}`, { state: collection })}
                className="bg-white border border-[#c2c7cc]/60 rounded-3xl p-6 hover:border-[#002434]/25 hover:shadow-md transition-all duration-200 text-left group cursor-pointer shadow-sm flex flex-col justify-between"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 select-none ${getColor(collection.id)}`}>
                    <FolderOpen className="w-5.5 h-5.5" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-extrabold text-[16px] text-[#191c1d] group-hover:text-[#002434] transition-colors truncate tracking-tight">
                      {collection.name}
                    </div>
                    {collection.description ? (
                      <p className="text-[13px] text-[#42474b] line-clamp-2 leading-relaxed font-semibold">
                        {collection.description}
                      </p>
                    ) : (
                      <p className="text-[13px] text-slate-400 italic font-semibold select-none">
                        No description provided.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[12px] font-bold text-[#42474b] pt-4 mt-4 border-t border-[#c2c7cc]/30 select-none w-full">
                  <div className="flex items-center gap-1.5">
                    <Book className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
                    <span>{(collection as any).word_count ?? 0} words</span>
                  </div>
                  <span className="text-[11px] text-[#002434] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all font-bold uppercase tracking-wider">
                    Open Folder →
                  </span>
                </div>
              </button>
            ))}

            {/* Quick Create Card */}
            <button 
              onClick={handleCreate}
              className="bg-white border border-[#c2c7cc]/60 border-dashed rounded-3xl p-6 hover:border-[#002434]/25 hover:bg-[#f2f4f5]/30 transition-all flex items-center justify-center min-h-[160px] cursor-pointer group shadow-sm select-none"
            >
              <div className="text-center space-y-2">
                <Plus className="w-6 h-6 text-slate-400 group-hover:text-[#002434] transition-colors mx-auto" strokeWidth={2.5} />
                <div className="text-[13.5px] font-extrabold text-[#42474b] group-hover:text-[#002434] transition-colors">Create Collection</div>
              </div>
            </button>
          </div>

          {/* Recently Updated Section */}
          <div className="bg-white border border-[#c2c7cc]/60 rounded-3xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#c2c7cc]/40 bg-[#f8fafb] select-none">
              <h2 className="font-extrabold text-[15px] text-[#002434] tracking-tight">Recently Updated Folders</h2>
            </div>
            <div className="divide-y divide-[#c2c7cc]/30">
              {collections.slice(0, 3).map((collection) => (
                <button
                  key={collection.id}
                  onClick={() => navigate(`/collections/${collection.id}`, { state: collection })}
                  className="w-full px-6 py-4.5 hover:bg-[#f2f4f5]/30 transition-all text-left flex items-center justify-between group cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 select-none ${getColor(collection.id)}`}>
                      <FolderOpen className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                    <div>
                      <div className="font-extrabold text-[14.5px] text-[#191c1d] group-hover:text-[#002434] transition-colors tracking-tight">
                        {collection.name}
                      </div>
                      <div className="text-[12px] text-[#42474b] mt-0.5 font-bold flex items-center gap-1.5 select-none">
                        <Book className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
                        <span>{(collection as any).word_count ?? 0} words</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[12.5px] font-bold text-slate-400 select-none">
                    Created {new Date(collection.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Creation Modal */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-3xl p-6 bg-white border border-[#c2c7cc]/60 shadow-2xl">
          <form onSubmit={handleSubmitCreate} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-[18px] font-extrabold text-[#002434] tracking-tight">New Collection</DialogTitle>
              <DialogDescription className="text-[13.5px] text-[#42474b] font-semibold leading-relaxed">
                Group vocabulary cards together under a single subject or course track.
              </DialogDescription>
            </DialogHeader>

            {createError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-bold text-rose-800 animate-in fade-in-50 duration-200 leading-normal">
                {createError}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="name" className="text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider select-none">Collection Name *</label>
                <input
                  id="name"
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="e.g. GRE Prep, Business Spanish..."
                  disabled={isCreating}
                  required
                  autoFocus
                  className="w-full h-10 px-3.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[14px] text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="description" className="text-[11.5px] font-bold text-[#42474b] uppercase tracking-wider select-none">Description (Optional)</label>
                <textarea
                  id="description"
                  value={newCollectionDesc}
                  onChange={(e) => setNewCollectionDesc(e.target.value)}
                  placeholder="Describe the learning objectives or contents of this collection..."
                  disabled={isCreating}
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-[#f2f4f5] border border-transparent focus:border-[#002434]/30 rounded-xl text-[13.5px] leading-relaxed text-[#191c1d] font-semibold placeholder:text-[#42474b]/50 focus:outline-none focus:bg-white transition-all duration-200 resize-none"
                />
              </div>
            </div>

            <DialogFooter className="flex sm:justify-end gap-3 pt-3 border-t border-[#c2c7cc]/40 mt-2">
              <DialogClose asChild>
                <button
                  type="button"
                  disabled={isCreating}
                  className="h-10 px-4 bg-white border border-[#c2c7cc]/70 text-[#42474b] font-bold rounded-xl text-[13.5px] hover:bg-[#f2f4f5] active:scale-95 transition-all select-none shadow-sm cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                type="submit"
                disabled={isCreating}
                className="h-10 px-5 bg-[#f2f4f5] border border-[#002434]/40 text-[#002434] hover:bg-[#eceeef] hover:border-[#002434]/60 font-bold rounded-xl transition-all text-[13.5px] flex items-center justify-center gap-2 disabled:opacity-50 min-w-[100px] cursor-pointer shadow-sm active:scale-95 select-none"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin text-[#002434]" strokeWidth={2.5} /> : 'Create Collection'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
