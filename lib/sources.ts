export interface Source {
  id: string
  name: string
  url: string
}

export const SOURCES: Source[] = [
  {
    id: 'google',
    name: 'Google News',
    url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
  },
  {
    id: 'nhk',
    name: 'NHK ニュース',
    url: 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml',
  },
  {
    id: 'bbc',
    name: 'BBC News (JP)',
    url: 'https://feeds.bbci.co.uk/japanese/rss.xml',
  },
  {
    id: 'itmedia',
    name: 'ITmedia',
    url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
  },
]

/**
 * タブ表示用のデータを SOURCES から生成します。
 * 先頭に「すべて」タブを追加します。
 */
export const TABS = [
  { id: 'all', label: 'すべて' },
  ...SOURCES.map((s) => ({ id: s.id, label: s.name })),
]
