<p align="center">
  <img src="docs/banner.png" alt="Gitube: discover open source like a video feed" width="100%">
</p>

<p align="center">
  <a href="https://andy7016.github.io/Gitube/"><b>Open the web app</b></a>
  &nbsp;|&nbsp;
  <a href="https://github.com/Andy7016/Gitube/releases/latest"><b>Download for desktop</b></a>
  &nbsp;|&nbsp;
  <a href="README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/Andy7016/Gitube/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Andy7016/Gitube?color=F5A800"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/Andy7016/Gitube"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-web%20%7C%20macOS%20%7C%20Windows%20%7C%20Linux-161B26">
</p>

**Gitube** lets you browse GitHub the way you scroll YouTube. Sign in with your GitHub account and get an endless feed of open-source projects picked for you. Star the ones you like in one click, or save them for later.

It is fully open source and has no server of its own: your token stays on your device, and every request goes straight to GitHub.

> The interface is currently in Chinese. An English UI is on the roadmap.

<p align="center">
  <img src="docs/screenshot.png" alt="Gitube screenshot" width="100%">
</p>

## Features

- **A feed picked for you.** Recommendations come from what you've recently starred, your own repositories, the interests you choose, and what you do in the app (star, save, open, "not interested"). Every card says why it's there: "because you starred X", "@someone starred this", "new this week".
- **Channels.** For you, Following (what people you follow just starred), New this week, Hot this month, plus one channel per interest (bioinformatics, LLMs, Rust…).
- **One-click actions.**
  - The star on each card stars the repo on your real GitHub account.
  - Hover a cover for *Watch later* and *Save*.
  - The ⋮ menu: save to a collection, copy the `git clone` command, "not interested", hide a topic or language.
  - On a project page, **press and hold Star** to star, save and follow the author in one go. Shortcuts: `S` star, `B` save to…, `L` watch later.
- **Project page** laid out like a video page: details and README on the left, related projects on the right.
- **Collections**, **Watch later**, **History**, **My stars**, and **Search** with full GitHub search syntax (`topic:bioinformatics stars:>500`).
- **Covers.** Projects with a custom social preview use it. Others get a generated cover: the background is the main language's color, and the brighter and denser the grid in the corner, the more active the project has been lately.
- Light and dark themes; works in mobile browsers too.

## Getting started: sign in with a token

1. Use the link on the sign-in page to open GitHub's "new token" page. The scopes are already ticked: `public_repo`, `read:user`, `user:follow`.
2. Pick an expiration, scroll down and click **Generate token**.
3. Copy the token (it starts with `ghp_`) and paste it into Gitube.

The token is stored only on your device and is only sent to the GitHub API. Fine-grained tokens work too: under Account permissions, set **Starring** to Read and write, and **Followers** to Read and write (only needed for "follow the author").

## Installing the desktop app

Download from [Releases](https://github.com/Andy7016/Gitube/releases):

| System | File |
| --- | --- |
| Mac with Apple silicon (M1/M2/M3/M4…) | `Gitube_x.x.x_aarch64.dmg` |
| Mac with Intel | `Gitube_x.x.x_x64.dmg` |
| Windows | `Gitube_x.x.x_x64-setup.exe` |
| Linux | `.AppImage` or `.deb` |

The app isn't signed with a paid Apple or Microsoft certificate, so the first launch is blocked once:

- **macOS:** if it says the developer can't be verified or the app is damaged, open *System Settings → Privacy & Security* and click *Open Anyway*, or run `xattr -cr /Applications/Gitube.app` in Terminal.
- **Windows:** if SmartScreen appears, click *More info → Run anyway*.

## Development

Requires Node.js 18 or later.

```bash
npm install
npm run dev          # web app at http://localhost:5173
```

The desktop app also needs [Rust](https://www.rust-lang.org/tools/install) (and on macOS, `xcode-select --install`):

```bash
npm run desktop:dev     # open the desktop window with hot reload
npm run desktop:build   # build installers into src-tauri/target/release/bundle/
```

## Releasing

Two workflows live in `.github/workflows/`:

- **Web** (`pages.yml`): every push to `main` builds and deploys to GitHub Pages. Before the first run, set *Settings → Pages → Source* to **GitHub Actions**.
- **Desktop** (`release.yml`): go to *Actions → 发布桌面软件 (Publish desktop) → Run workflow*. About 15 minutes later, installers for every platform appear under Releases. Bump `"version"` in `src-tauri/tauri.conf.json` before each new release.

## How recommendations work

Everything runs on your device; see `src/lib/recommend.ts`.

1. **Profile.** Weights for each topic and language, from your latest 100 stars (newer stars count more), your own repositories, your chosen interests (strongest signal), and in-app actions (star +2.5, save +2, watch later +1, open +0.6, not interested −3, with a 30-day half-life).
2. **Candidates.** A few topics are sampled by weight (each searched three ways: all-time top, recently active, new this year), plus "similar to something you starred", "new in your languages", "new this week" and "something different". All of them go out as **one** GraphQL request.
3. **Filtering.** Drops anything already starred, marked not interested, in a hidden topic or language, or shown in the last 3 days.
4. **Ranking.** 50% interest match + 25% popularity + 15% recent activity + a little randomness, then spread out so the same owner, language or source doesn't cluster.
5. Projects starred by people you follow are mixed in.

The "how Gitube sees you" section in Settings shows your current profile.

## Where your data lives

- **Stars and follows** go straight to your GitHub account.
- **Collections, watch later, history and feedback** have no public GitHub API, so they're kept in local storage per GitHub user. The web and desktop apps keep separate copies.
- **Your token** stays in local storage and is removed when you sign out.

## Project layout

```
src/
  api/github.ts        GitHub GraphQL / REST calls
  lib/recommend.ts     recommendation engine
  lib/channels.ts      home-page channels
  lib/interests.ts     interest tags ↔ GitHub topics
  lib/cover.ts         generated covers
  lib/actions.ts       save, watch later, not interested, star + save + follow
  store/               state (zustand)
  components/          cards, covers, star button, menus, dialogs…
  pages/               sign-in, onboarding, home, project, library, search, settings
src-tauri/             desktop app (Tauri)
.github/workflows/     web and desktop publishing
```

## License

[MIT](LICENSE)
