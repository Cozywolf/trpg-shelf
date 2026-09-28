# TRPG 藏書閣

手機上用的 TRPG 藏書管理 App（PWA）。對準書背條碼就能讀出 ISBN、自動查詢書籍資料，在書店也能快速確認有沒有買過。資料同步到你自己的 Google 試算表。

- **掃描新增**：開相機即時掃 ISBN 條碼或 QR code，自動帶入書名、作者、出版社、出版日期、封面，並依書名和出版社推測系統
- **查重**：掃條碼或打兩三個字搜尋，沒有網路也能查。搜尋有別名對照（克蘇魯＝CoC＝クトゥルフ）
- **同人本、自印劇本**：手動新增，拍封面存檔，QR 內容也會拿來查重
- **重複檢查**：ISBN 已經收藏的書不能再登錄（掃描時就會跳出警告）；沒有 ISBN 的書若書名完全相同，會問你要不要繼續登錄（不同版次、場次或複本可以選「仍要登錄」）
- **標籤、備註、流水號、收藏位置**
- **Google 試算表同步**：電腦上可以直接看、直接改，改了會同步回手機
- **CSV 匯入／匯出**

App 網址：https://cozywolf.github.io/trpg-shelf/

---

## 一、開啟 GitHub Pages（只要做一次）

1. 到 https://github.com/Cozywolf/trpg-shelf/settings/pages
2. 「Build and deployment」→ Source 選 **Deploy from a branch**
3. Branch 選 **main**，資料夾選 **/(root)**，按 **Save**
4. 等 1～2 分鐘，https://cozywolf.github.io/trpg-shelf/ 就能開了

## 二、設定 Google 試算表同步

1. 開一個新的 Google 試算表（名稱隨意，例如「TRPG 藏書」）
2. 選單 **擴充功能 → Apps Script**
3. 把編輯器裡原本的內容全部刪掉，貼上本 repo 的 [`apps-script/Code.gs`](apps-script/Code.gs)
4. 找到第 10 行左右的 `const TOKEN = '請改成你自己的密語';`，改成只有你知道的一串字（例如 `'my-dice-2026-xyz'`），按儲存
5. 右上角 **部署 → 新增部署作業**
   - 類型（齒輪圖示）選 **網頁應用程式**
   - 執行身分：**我**
   - 誰可以存取：**所有人**（不用登入 Google 的那個選項）
   - 按 **部署**
6. 第一次會要求授權：選你的帳號 → 出現「Google 尚未驗證這個應用程式」時按 **進階 → 前往（不安全）** → **允許**。這是你自己寫的腳本，只會存取你自己的試算表和雲端硬碟
7. 複製「網頁應用程式」的網址（結尾是 `/exec`）
8. 在手機 App 右上角齒輪 → 貼上網址和密語 → **儲存並同步**

試算表會自動建立「藏書」工作表。封面照片會存在雲端硬碟的「TRPG藏書閣封面」資料夾（設為「知道連結的人可檢視」，App 才能顯示）。

> 之後如果修改了 `Code.gs`，要用 **部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「新版本」→ 部署**，網址才會維持不變。

## 三、裝到 Android 手機

1. 用 **Chrome** 開 https://cozywolf.github.io/trpg-shelf/
2. 右上角 ⋮ → **加到主畫面**（或「安裝應用程式」）
3. 第一次掃描時允許使用相機

之後從主畫面圖示開啟，會像一般 App 一樣全螢幕，離線也能搜尋。

## 書籍資料來源

| 書籍 | 資料來源 | 封面 |
|---|---|---|
| 日本書（ISBN 978-4） | [openBD](https://openbd.jp/)（資料來自國立國會圖書館），加上 Google Books | Google Books 有才有，常常沒有 |
| 美國等其他書 | Google Books、[Open Library](https://openlibrary.org/) | 通常有 |

幾個來源會同時查詢，一個失敗時會用其他來源的結果。日本書的封面資料庫已經停止免費提供，查不到封面時請按「拍封面」。

## 小提醒

- 試算表可以直接編輯或新增列（至少填「書名」），下次同步時手機會拿到。請不要修改第一列的欄位名稱，也不要刪掉「ID」欄
- 查不到資料時可以勾「資料待確認」先存起來，之後再補
- 換手機時只要重新填同步設定，資料會從試算表下載回來
- 更新 App 程式後，把 `sw.js` 裡的 `VERSION` 加一，手機才會抓到新版

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`style.css`、`app.js` | App 本體 |
| `sw.js`、`manifest.webmanifest`、`icons/` | 離線快取、安裝到主畫面 |
| `zxing.min.js` | 條碼解碼（[ZXing](https://github.com/zxing-js/library)，Apache 2.0，授權見 `LICENSE-zxing.txt`），手機沒有內建條碼辨識時使用 |
| `apps-script/Code.gs` | Google 試算表同步後端 |
