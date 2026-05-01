# WHOLEI: WHOLEI verification

生成日時: 2026/5/1 18:34:19

## ネットワーク図

![[network.svg]]

## サマリー

- Source ファイル数: 3
- 検出した関係数: 3
- Obsidian Graph 用ノート: `00_wholei_map`
- プレゼン資料: `WHOLEI.pptx`

## Obsidian ノート

- [[WHOLEI - audit-notes.txt]]: `source/audit-notes.txt`
- [[WHOLEI - requirements.md]]: `source/requirements.md`
- [[WHOLEI - sales.csv]]: `source/sales.csv`

## 強い関係

| ファイル A | ファイル B | スコア | 根拠 | 共通信号 |
|---|---|---:|---|---|
| audit-notes.txt | requirements.md | 11 | ファイル名参照 + 共通語彙 | sales, audit-notes, txt, audit, notes, data, requirements, csv |
| audit-notes.txt | sales.csv | 7 | ファイル名参照 + 共通語彙 | sales, audit, csv, checked |
| requirements.md | sales.csv | 6 | ファイル名参照 + 共通語彙 | sales, audit, csv |

## 確認方法

このフォルダを Obsidian vault として開き、Graph view を確認します。WHOLEI が生成したノートは、共通語彙と明示的なファイル名参照にもとづいてリンクされています。
