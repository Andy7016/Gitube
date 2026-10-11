# Gitube / RepoFlow

Browse real GitHub projects with a YouTube-style feed, search, channels, collections, watch later, history and real Stars. The default interface is based on [Andy7016/Gitube](https://github.com/Andy7016/Gitube), integrated with a same-origin Node server for GitHub authentication, complete README rendering, account interest profiles and technical provenance graphs.

The repository is based on the rebuilt upstream commit `418daee527607dd0a97b1c8d675bf0a7a4895ecf`. Its history was fetched independently; the previous upstream history was not imported. See [upstream attribution](gitube/UPSTREAM.md), the [MIT license](LICENSE) and [integration decision](docs/adr/0007-rebuilt-upstream-history.md). [中文](README.md).

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Public browsing works without signing in. API and network failures are shown with retry controls; the application contains no demonstration data.

Click **GitHub 登录** to sign in through GitHub. The first local connection uses GitHub's App manifest registration flow and saves application credentials on the server automatically. Users do not need to paste a personal access token or edit configuration files. Access tokens stay in the server session; the browser uses an HttpOnly cookie. The App requests Metadata read and Starring write permissions and has no webhook.

If that GitHub App cannot write Stars, use **启用站内 Star** in the error message or the local settings connection link. The browser wizard provides OAuth App registration and callback details. Enter the registered Client ID and Client secret on that local page, then authorize through GitHub. Credentials are saved separately in ignored `.local/github-oauth.json` only after scope and identity validation succeeds; the original App connection remains. This requests `read:user public_repo`, which also grants public repository write access. The application uses it for public reads and user-requested Stars. See [ADR 0013](docs/adr/0013-oauth-connection-for-public-stars.md).

## Integrated features

- Full, sanitized repository READMEs on dedicated detail pages, including relative links and images.
- Real Star actions, local collections and watch later, copy-link and repository buttons. Local data is isolated by guest / GitHub account.
- Interest profiles from up to 1,000 current Stars and 300 owned public repositories, with actual counts and sampling limits.
- Adjustable per-following recommendation weights, plus small feedback from focused reading longer than three minutes, or one minute with an original-repository visit. A repository qualifies at most once per account per 24 hours.
- Normal, taste-changing and random feed modes. Taste-changing targets an adjustable 50/50 mix of selected topics and other candidates, with shortage backfill; random draws from actual public search candidates. Both exploration modes continue learning browsing preferences for normal recommendations. See [ADR 0010](docs/adr/0010-recommendation-controls-and-reading-signals.md).
- Each mode retains its loaded feed and scroll position during the current page run. Returning restores that batch; explicit refresh replaces it, and further scrolling can paginate. A full page reload starts a new run.
- Automatic one-hop provenance analysis from README credits / citations, explicit dependencies and related developer projects. Results keep source evidence, show progress and allow manual expansion.
- Topic overlap controls node area, with persistent names at 30% or higher. Select a node to center and highlight its connections, or switch to the full graph. Expanded branches have separate space and readable parent paths; language fallback does not count as topic overlap. See [ADR 0008](docs/adr/0008-graph-branches-and-camera.md).
- Related-project and copyright / license-attribution links also participate in discovery. Evidence-supported arrows run from the technical provider to the consumer; uncertain references, associations and conflicting claims stay undirected. The inspector keeps the original excerpt, source line, target URL and rule explanation. See [ADR 0009](docs/adr/0009-readme-evidence-and-technical-flow.md).
- A standalone `/graph` workspace. Up to 120 visible nodes and five manually expanded levels; each collection task is bounded to 24 direct sources, four people, 40 requests and 90 seconds.
- Graph workspaces retain manual expansions, selection and camera state across navigation. The standalone entry restores its latest root; interrupted analysis resumes only on request. See [ADR 0012](docs/adr/0012-resumable-feed-and-graph-workspaces.md).

The main frontend is in `gitube/src/`, shared services in `server/`. The earlier RepoFlow frontend remains in `src/` and can be built with `npm run build:repoflow`.

## Build and verify

```sh
npm run check
npm start
```

Stop the development server before starting the production preview on the same port. Development uses Vite on 5173 with `/api` proxied to 5314. Production serves `dist/` and the API together on 5173. Existing local App credentials in ignored `.local/github-app.json` continue to work.

This integration requires a Node backend; the upstream static Pages and desktop release workflows are not enabled. Upstream Tauri source is retained in `src-tauri/` for later integration. See the [Chinese deployment guide](README.md#正式部署) for HTTPS configuration and session-store limitations.

Tests use isolated GitHub responses and never authorize or write to a real account. Current evidence is recorded in [acceptance](docs/acceptance.md). The [recommendation research note](docs/recommendation-research.md) records the future investigation of familiar high-Star projects; normal mode retains the existing popularity formula, while exploration ratios and reading weights remain initial policies for further evaluation.
