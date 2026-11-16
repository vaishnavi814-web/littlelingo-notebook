# littlelingo English journal

littlelingo is a local-first English notebook. The Windows Electron app stores notebook entries and images in the app's local browser database and works without internet, MongoDB, or a running server. AI tools use optional Ollama on this computer. YouGlish videos and external grammar references require internet.

## Build the Windows app

On a Windows computer with Node.js 22 or newer:

```powershell
npm install
npm install --prefix client
npm run build
```

The Windows NSIS installer is written to `release`. Install littlelingo on each Windows computer that needs it; an `.exe` installer cannot run on macOS, Linux, iOS, or Android. Separate platform builds are required for macOS and Linux.

Notebook data is stored per Windows user in Electron's application data folder and is not placed next to the installed program. Copy/export your notebook from the app's **Settings & backup** page before moving to another computer or uninstalling.

## Run the web app locally

The React/Vite client and Express service can also be run during development:

1. Install **Ollama** from `https://ollama.com/download` and open it so its local service is running. In a terminal, download the free `llama3.2:3b` model once if you want to use AI:

   ```powershell
   ollama pull llama3.2:3b
   ```

   The model download requires an internet connection and several GB of disk space. After it is downloaded, AI features run locally; your words are not sent to an AI cloud service. Notebook pages and other non-AI features work without Ollama.
2. In a terminal, start the API:

   ```powershell
   cd "F:\My English Notebook\english-notebook\server"
   npm install
   npm run dev
   ```

3. In a second terminal, start the client:

   ```powershell
   cd "F:\My English Notebook\english-notebook\client"
   npm install
   npm run dev
   ```

4. Open `http://localhost:5173`.

The interface uses system fonts and does not fetch fonts from Google.

Text-to-lesson generation uses the configured local Ollama model and requires Ollama to be running. Source text is limited to 20,000 characters, is sent to the local API only, and is not saved by the server; generated lesson content and quiz progress are stored locally.

## Features

- Create, edit, search, and delete dated notebook pages
- Read saved pages in a dedicated open-notebook view with configurable paper and lines, formatted writing, photos, stickers, page details, and saved vocabulary; turn between dated pages with the navigation buttons, arrow keys, or a horizontal swipe, and switch to the editor only when you choose Edit page
- Categorize saved words, sentences, phrases, phrasal verbs, idioms, collocations, and expressions from the sidebar
- Add definitions and example sentences to vocabulary items
- Save phonetics, part of speech, multiple examples, synonyms, antonyms, tags, difficulty, and learning goals; play pronunciations with your browser’s local speech engine or hear vocabulary in real-world YouGlish video examples
- Favorite notebook pages and vocabulary, then filter your collections by tag or difficulty
- Review saved vocabulary as flashcards or sentence-completion quizzes using saved example sentences and vocabulary as answer choices; rate each answer Again, Hard, or Remembered to schedule the next review in local MongoDB
- Study original grammar lessons from beginner to proficiency, with topic search, level filters, examples, common-mistake notes, quick checks, and browser-local completion tracking; lessons link to British Council, Cambridge Dictionary Grammar, or Purdue OWL for further reading
- Add your own grammar lessons with a heading, date, level, notes, examples, common-mistake reminders, and an optional multiple-choice quick check; edit or delete them anytime from the “My lessons” filter
- Turn a plain-text `.txt` or SubRip `.srt` file into a locally generated English lesson with vocabulary, examples, and a quiz; subtitle timestamps are removed, the source can be reviewed before generation, and generated lessons stay in this browser
- Track current and best writing streaks in a monthly notebook activity calendar
- View words learned, review accuracy, and six-month writing activity on the progress dashboard
- Ask the local Ollama AI to explain a typed or selected English word/sentence
- Ask the local Ollama AI for grammar and clarity suggestions without changing your original writing
- Restore soft-deleted pages from the recycle bin, or permanently remove them
- Export JSON backups (including the recycle bin), HTML notebooks, or print/save a PDF
- Choose notebook themes, paper colors, and writing-line styles; settings are stored in this browser
- Use Ctrl/⌘+K to search, Ctrl/⌘+N for a new page, Ctrl/⌘+S to save, and Esc to close dialogs; the editor keeps a recoverable local draft
- Format writing with font choice, bold, italic, underline, lists, and links
- Decorate notebook pages with 50 removable, saved SVG stickers across cottagecore, botanicals, pressed florals, labeled specimen plates, and chunky kawaii collections; search or filter the picker by collection
- Save JPG, PNG, and WebP reference images locally (up to 8 MB)
- Responsive notebook-inspired layout

YouGlish examples use its official JavaScript widget and require an internet connection; it is loaded only when you open a word’s YouGlish player. The YouGlish plans page lists the Widget and JS API as free for non-commercial education use; commercial use may require a separate agreement. The REST API is a different, paid/keyed product. See [YouGlish JS API documentation](https://youglish.com/api/doc/js-api) and [plans](https://youglish.com/api/plans).

Pages and uploaded images are stored locally. Export a JSON backup from **Settings & backup** to move your notebook between devices.
