/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  Trash2,
  CheckCircle2,
  Check,
  LayoutDashboard,
  Shuffle,
  Gavel,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AuctionItem, AuctionState, ItemType, GuildMember } from './types';
import { saveState, loadState } from './lib/storage';

export default function App() {
  const [state, setState] = useState<AuctionState>(() => loadState());
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [queueNameModalItemId, setQueueNameModalItemId] = useState<string | null>(null);
  const [queueNameInput, setQueueNameInput] = useState('');

  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ItemType>('Fragment Card');

  const queueModalItem = useMemo(
    () => state.items.find(i => i.id === queueNameModalItemId) ?? null,
    [state.items, queueNameModalItemId]
  );

  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeAuctions = useMemo(() => 
    state.items.filter(item => item.status === 'active'), 
    [state.items]
  );

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    const newItem: AuctionItem = {
      id: crypto.randomUUID(),
      name: newItemName,
      type: newItemType,
      winnerName: null,
      status: 'active',
      interestedMemberIds: state.members.map(m => m.id),
      createdAt: Date.now(),
    };
    setState(prev => ({ ...prev, items: [newItem, ...prev.items] }));
    setIsAddItemOpen(false);
    setNewItemName('');
  };

  const handleShuffleList = (itemId: string) => {
    setState(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id === itemId) {
          return {
            ...item,
            interestedMemberIds: [...item.interestedMemberIds].sort(() => Math.random() - 0.5)
          };
        }
        return item;
      })
    }));
  };

  const handleCompleteAuction = (itemId: string, winnerName: string | null) => {
    setState(prev => ({
      ...prev,
      items: prev.items.map(item => 
        item.id === itemId ? { ...item, status: 'completed', winnerName } : item
      ),
    }));
  };

  const handleDeleteItem = (itemId: string) => {
    setState(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== itemId)
    }));
  };

  const openQueueNameModal = (itemId: string) => {
    setQueueNameModalItemId(itemId);
    setQueueNameInput('');
  };

  const handleAddNameToQueue = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = queueNameInput.trim();
    const itemId = queueNameModalItemId;
    if (!raw || !itemId) return;

    setState(prev => {
      const existing = prev.members.find(
        m => m.name.toLowerCase() === raw.toLowerCase()
      );
      const memberId = existing?.id ?? crypto.randomUUID();
      const members = existing
        ? prev.members
        : [...prev.members, { id: memberId, name: raw, role: 'Member' as const }];

      const items = prev.items.map(it => {
        if (it.id !== itemId) return it;
        if (it.interestedMemberIds.includes(memberId)) return it;
        return { ...it, interestedMemberIds: [...it.interestedMemberIds, memberId] };
      });

      return { ...prev, members, items };
    });

    setQueueNameInput('');
    setQueueNameModalItemId(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <div className="shrink-0 w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Gavel className="text-white w-6 h-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate underline decoration-blue-600/50 decoration-4 underline-offset-4">
                Outlast Guild Bid
              </h1>
              <p className="text-slate-400 text-sm font-medium">Auction queue</p>
            </div>
          </div>
          <nav
            className="flex w-full sm:w-auto rounded-2xl bg-slate-900 p-1 border border-slate-800 gap-1"
            aria-label="Main"
          >
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" aria-hidden />
              Queues
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <History className="w-4 h-4 shrink-0" aria-hidden />
              Logs
            </button>
          </nav>
        </div>
      </header>

      <main className="min-h-screen">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-10 sm:py-12">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                  <AnimatePresence>
                    {activeAuctions.map(item => (
                      <QueueCard 
                        key={item.id} 
                        item={item} 
                        members={state.members}
                        onOpenAddName={openQueueNameModal}
                        onShuffle={handleShuffleList}
                        onComplete={handleCompleteAuction}
                        onDelete={handleDeleteItem}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                {activeAuctions.length === 0 && (
                  <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-[2rem] p-24 text-center">
                    <p className="text-slate-500 font-medium">No items listed. Use Add Item to get started.</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <h2 className="text-2xl font-bold text-white mb-8">Bidding History</h2>
                {state.items.filter(i => i.status !== 'active').map(item => (
                  <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex justify-between items-center group transition-all hover:border-slate-700">
                    <div className="flex items-center gap-8">
                       <div className="p-4 bg-slate-800 rounded-2xl">
                          <CheckCircle2 className="text-green-500 w-6 h-6" />
                       </div>
                       <div>
                          <h3 className="text-xl font-bold text-white mb-1">{item.name}</h3>
                          <p className="text-[10px] font-black uppercase text-slate-500 tracking-[0.1em] font-mono">Won by: <span className="text-amber-400">{item.winnerName || 'No taker'}</span></p>
                       </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-3 text-slate-600 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {queueNameModalItemId && queueModalItem && (
          <Modal
            title="Add name to queue"
            onClose={() => {
              setQueueNameModalItemId(null);
              setQueueNameInput('');
            }}
          >
            <form key={queueNameModalItemId} onSubmit={handleAddNameToQueue} className="space-y-6">
              <p className="text-sm text-slate-400 font-medium leading-relaxed">
                For: <span className="text-white font-bold">{queueModalItem.name}</span>
              </p>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">
                  Character name (IGN)
                </label>
                <input
                  autoFocus
                  required
                  placeholder="e.g. ShadowHunter"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={queueNameInput}
                  onChange={e => setQueueNameInput(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Add to queue
              </button>
            </form>
          </Modal>
        )}

        {isAddItemOpen && (
          <Modal title="New bid item" onClose={() => setIsAddItemOpen(false)}>
            <form onSubmit={handleAddItem} className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">Item name</label>
                <input 
                  autoFocus required
                  placeholder="e.g. Puppet Card, +15 Ancient gear"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">Type</label>
                <select 
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-600/50 appearance-none"
                  value={newItemType}
                  onChange={e => setNewItemType(e.target.value as ItemType)}
                >
                  <option value="Fragment Card">Fragment Card</option>
                  <option value="LND">Light And Dark Feathers</option>
                  <option value="TNS">Time And Space Feathers</option>
                  <option value="Ancient Item">Ancient gear</option>
                  <option value="Other">Miscellaneous</option>
                </select>
              </div>
              <button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Confirm Add Item
              </button>
            </form>
          </Modal>
        )}

      </AnimatePresence>
    </div>
  );
}

function QueueCard({ item, members, onOpenAddName, onShuffle, onComplete, onDelete }: { 
  key?: React.Key,
  item: AuctionItem, 
  members: GuildMember[], 
  onOpenAddName: (itemId: string) => void,
  onShuffle: (id: string) => void,
  onComplete: (id: string, winner: string | null) => void,
  onDelete: (id: string) => void
}) {
  const typeColors = {
    'Fragment Card': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    'LND': 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    'TNS': 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    'Ancient Item': 'text-red-400 border-red-500/30 bg-red-500/10',
    'Other': 'text-slate-400 border-slate-700 bg-slate-800'
  };

  return (
    <motion.div 
      layout
      onClick={() => onOpenAddName(item.id)}
      title="Click to add a name to this queue"
      className="group bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl flex flex-col gap-6 cursor-pointer transition-[border-color,box-shadow,background-color,transform] duration-200 ease-out hover:border-blue-500/45 hover:bg-slate-800/60 hover:shadow-blue-900/25 hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
    >
      <div className="flex justify-between items-start">
        <div>
          <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-lg border font-mono ${typeColors[item.type]}`}>
            {item.type}
          </span>
          <h3 className="text-3xl font-black text-white mt-4 tracking-tight leading-none">{item.name}</h3>
        </div>
        <div className="flex gap-2">
           <button
             type="button"
             onClick={e => { e.stopPropagation(); onDelete(item.id); }}
             className="p-2 text-slate-700 hover:text-red-500 transition-all"
           >
             <Trash2 className="w-5 h-5" />
           </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          
          <button 
            type="button"
            onClick={e => { e.stopPropagation(); onShuffle(item.id); }}
            className="flex items-center gap-2 bg-slate-800 hover:bg-blue-600 text-[10px] font-black text-white px-4 py-2 rounded-xl transition-all active:scale-95"
          >
            <Shuffle className="w-4 h-4" />
            SHUFFLE QUEUE
          </button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-3xl p-4 flex flex-col gap-2 min-h-[120px]">
          <AnimatePresence mode="popLayout">
            {item.interestedMemberIds.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                 <p className="text-xs text-slate-500 font-bold text-center">No one in queue yet. Click the card to add a name.</p>
              </div>
            ) : (
              item.interestedMemberIds.map((mid, idx) => {
                const m = members.find(member => member.id === mid);
                if (!m) return null;
                return (
                  <motion.div 
                    layout
                    key={mid}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`flex items-center justify-between p-3 rounded-2xl border ${idx === 0 ? 'bg-blue-600/20 border-blue-500/50' : 'bg-slate-900 border-slate-800'} transition-all`}
                  >
                    <div className="flex items-center gap-4">
                      <span className={`w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black ${idx === 0 ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-200">{m.name}</span>
                    </div>
                    {idx === 0 && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onComplete(item.id, m.name); }}
                        title="Mark winner"
                        aria-label="Mark as got item"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500 text-white hover:bg-green-400 transition-colors active:scale-95"
                      >
                        <Check className="h-4 w-4 stroke-[2.5]" />
                      </button>
                    )}
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 overflow-hidden shadow-2xl">
        <h3 className="text-2xl font-black text-white mb-8">{title}</h3>
        {children}
      </motion.div>
    </div>
  );
}
