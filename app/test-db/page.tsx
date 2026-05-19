"use client";

import { useState, useEffect } from "react";

export default function TestDbPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("ロード中...");

  // 1. データベースから取得する関数
  const fetchDbItems = async () => {
    setLoading(true);
    setStatus("データベースから取得中...");
    try {
      const res = await fetch("/api/storage");
      const data = await res.json();
      
      if (Array.isArray(data)) {
        setItems(data);
        setStatus(`データベースから ${data.length} 件取得しました`);
      } else {
        throw new Error(data.error || "データの形式が不正です");
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`取得エラー: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. RSSを取得してデータベースに保存する関数
  const syncToDb = async () => {
    setLoading(true);
    setStatus("1. RSSフィードを最新状態で取得中...");
    try {
      const rssRes = await fetch("/api/rss");
      const rssData = await rssRes.json();
      
      if (!rssData.items || !Array.isArray(rssData.items)) {
        throw new Error("RSSデータの取得に失敗しました");
      }

      setStatus(`2. DBへ ${rssData.items.length} 件を保存中...`);

      const saveRes = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rssData.items),
      });
      
      if (!saveRes.ok) {
        throw new Error("保存処理に失敗しました");
      }

      setStatus("3. 保存完了！データベースを再読み込みします...");
      
      await fetchDbItems();
    } catch (e: any) {
      console.error(e);
      setStatus(`同期エラー: ${e.message}`);
      setLoading(false);
    }
  };

  // ページ読み込み時にDBからデータを取得
  useEffect(() => {
    fetchDbItems();
  }, []);

  return (
    <main className="min-h-screen py-12 px-4 md:px-8 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Supabase DB テストページ</h1>
        <p className="text-foreground/60">
          このページは、APIを経由して正しくデータが保存・取得できているかを確認するための簡易ページです。
        </p>
      </header>

      <div className="flex flex-wrap gap-4 mb-6">
        <button
          onClick={fetchDbItems}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
        >
          DBから再取得
        </button>
        <button
          onClick={syncToDb}
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
        >
          RSSを取得してDBに保存
        </button>
      </div>

      <div className="mb-8 p-4 rounded-lg bg-foreground/5 border border-foreground/10 font-mono text-sm">
        現在のステータス: <span className="font-semibold">{status}</span>
      </div>

      <div className="space-y-4">
        {items.length === 0 && !loading && (
          <p className="text-center py-12 text-foreground/50">
            データがありません。「RSSを取得してDBに保存」を実行してください。
          </p>
        )}
        
        {items.map((item: any) => (
          <div key={item.id} className="p-4 rounded-xl border border-foreground/10 bg-card hover:bg-card/80 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold px-2 py-1 bg-blue-500/10 text-blue-500 rounded">
                {item.sourceName}
              </span>
              <span className="text-xs text-foreground/40">
                {item.pubDate ? new Date(item.pubDate).toLocaleString("ja-JP") : "日付不明"}
              </span>
            </div>
            <a href={item.link} target="_blank" rel="noopener noreferrer" className="block text-lg font-semibold hover:text-blue-500 transition-colors">
              {item.title}
            </a>
            {item.contentSnippet && (
              <p className="text-sm text-foreground/60 mt-2 line-clamp-2">
                {item.contentSnippet}
              </p>
            )}
            <div className="mt-3 text-xs text-foreground/30 font-mono">
              DB ID: {item.id}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
