# Research Constellation

Explore your research network from an ORCID iD — how it connects, evolves, and expands.

**https://kenjifujita119.github.io/research-constellation/**

[日本語](#日本語)

Type your name or ORCID iD and see:

- **Shape** — everyone you have written with, placed by who wrote with whom, played back year by year.
- **Reach** — a globe of the countries whose researchers have cited you, self-citations left out.
- **Collaborators** — people you have not written with yet, and the co-authors who could introduce you. You choose what the list is ranked by (same topic, they cite you, shared co-authors, and so on), and each suggestion shows why it is there.

Free, no account, nothing to install.

## How it works

There is no server. The site is a set of static files on GitHub Pages, and everything else happens in your browser.

- **Data** is read from [OpenAlex](https://openalex.org) (CC0) directly by your browser. The ORCID iD is only passed to OpenAlex as an identifier; the ORCID API is never called.
- **What you look up stays on your device.** Results are kept in your browser (IndexedDB) for 30 days so reopening is instant, then read again to pick up corrections. Papers you set aside as not yours are kept there too (localStorage). Clearing this site's data in your browser removes all of it.
- **Visits are counted** with [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/). It sets no cookies. It records the page address with the query cut off — which page was opened, never whose ORCID iD — plus the previous page, browser and OS versions, and load timings. Only the published site has it; running the code yourself sends nothing.

### The free daily limit

OpenAlex gives every connection a free daily allowance without an API key, reset at midnight UTC. Your browser uses its own, so nobody pays and you share it with nobody.

Shape uses very little. Reach reads the papers that cite you, which for a long career can be about a fifth of the day. **Collaborators is the expensive one**: it reads the co-authors of your co-authors, which takes a few minutes and 30–70% of the day's allowance. The page tells you how long it will take before it starts, and a finished search is saved, so it is done once.

### When papers that are not yours show up

OpenAlex sometimes merges people with the same name into one author record. The app does not guess which papers are intruders — every automatic rule tried also threw out real papers. **My papers** shows how to fix your record on OpenAlex itself, which corrects it for everyone, and until that takes effect lets you set papers aside on your own device.

## Run it locally

Node.js 24 or later.

```bash
npm ci
npm run dev      # http://localhost:3000
npm test         # unit tests (node:test)
npm run lint
npm run build    # static export to out/
```

The published site is built by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`. It passes in the base path as `PAGES_BASE_PATH` (GitHub Pages serves the site under `/research-constellation/`) and the analytics token as `CF_BEACON_TOKEN`. Without them the export works at the root path and has no analytics.

## Support

Made in spare time by one researcher. If it helped, you can [leave a tip on Ko-fi](https://ko-fi.com/kenjifujita).

## Credits and licence

- Code: [MIT](LICENSE) © 2026 Kenji Fujita
- Data: [OpenAlex](https://openalex.org) (CC0)
- Drawing: [3d-force-graph](https://github.com/vasturiano/3d-force-graph) and [three.js](https://threejs.org) (MIT)
- Country borders: [Natural Earth](https://www.naturalearthdata.com) (public domain), via [world-atlas](https://github.com/topojson/world-atlas)

---

## 日本語

ORCID iD から、自分の研究ネットワークがどうつながり、どう育ち、どこへ広がっているかを探索するツールです。

**https://kenjifujita119.github.io/research-constellation/**

名前か ORCID iD を入れると、次の3つが見られます。

- **Shape** — これまでの共著者全員を、誰と誰が一緒に書いたかで配置し、年ごとに再生します。
- **Reach** — あなたの論文を引用した研究者がいる国を地球儀に表示します（自己引用は除きます）。
- **Collaborators** — まだ一緒に書いたことのない人と、その人を紹介できる共著者を示します。何を根拠に並べるか（テーマの近さ、あなたを引用している、共通の共著者など）は自分で選べて、候補ごとに挙がった理由が表示されます。

無料で、アカウント登録もインストールも要りません。

### しくみ

サーバーはありません。GitHub Pages に置いた静的ファイルだけで、ほかはすべてブラウザの中で動きます。

- **データ**は [OpenAlex](https://openalex.org)（CC0）から、あなたのブラウザが直接読みます。ORCID iD は識別子として OpenAlex に渡すだけで、ORCID の API は使いません。
- **調べた内容はあなたの端末に残ります。** 結果はブラウザ内（IndexedDB）に30日間保存し、次に開いたときはすぐ表示します。30日を過ぎると、OpenAlex 側の訂正を反映するため読み直します。自分の論文ではないとして外した論文もブラウザ内（localStorage）に保存します。ブラウザでこのサイトのデータを消せば、すべて消えます。
- **訪問数を数えています。** [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) を使い、cookie は使いません。記録されるのは、クエリを削ったページのアドレス（どのページを開いたかであって、誰の ORCID iD かではありません）、直前のページ、ブラウザと OS のバージョン、表示にかかった時間です。公開サイトにだけ入っていて、手元でコードを動かしても何も送られません。

#### 1日の無料枠

OpenAlex は、API キーなしの接続ごとに1日の無料枠を設けています。枠は UTC の深夜0時にリセットされます。使うのはあなたのブラウザ自身の枠なので、誰も支払わず、ほかの人と枠を分け合うこともありません。

Shape はほとんど枠を使いません。Reach はあなたを引用した論文を読むので、論文の多い研究者ではその日の枠の5分の1ほどを使います。**いちばん重いのは Collaborators です。** 共著者の共著者まで読むので数分かかり、その日の枠の30〜70%を使います。始める前に所要時間を画面に表示し、終わった結果は保存するので、実行は一度で済みます。

#### 自分のではない論文が混ざっているとき

OpenAlex は、同姓同名の別人を一人の著者にまとめてしまうことがあります。このアプリは、どれが紛れ込んだ論文かを自動では判定しません。試した自動ルールは、どれも本人の論文まで外してしまったからです。**My papers** では、OpenAlex 上で自分の記録を直す方法を案内します（直せば全員にとって正しくなります）。それが反映されるまでのあいだは、自分の端末の中だけで論文を除外できます。

### 手元で動かす

Node.js 24 以上が必要です。コマンドは英語版の [Run it locally](#run-it-locally) と同じです。

### 支援

平日の夜と休日に1人で作っています。[Ko-fi](https://ko-fi.com/kenjifujita)でチップを頂けると励みになります。

### クレジットとライセンス

- コード: [MIT](LICENSE) © 2026 Kenji Fujita
- データ: [OpenAlex](https://openalex.org)（CC0）
- 描画: [3d-force-graph](https://github.com/vasturiano/3d-force-graph)、[three.js](https://threejs.org)（MIT）
- 国境: [Natural Earth](https://www.naturalearthdata.com)（パブリックドメイン）、[world-atlas](https://github.com/topojson/world-atlas) 経由
