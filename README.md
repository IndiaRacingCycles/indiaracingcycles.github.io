# India Racing Cycles

**DISCOVER | SHARE | RACE**

A Material Design 3-inspired cycling events, archive and news site. This repository contains the standalone India Racing Cycles website. It is separate from the personal portfolio repository.

## Website

Once the existing GitHub Pages site serves the repository's `main` branch, the site path is:

`https://indiaracingcycles.github.io/IndiaRacingCycles/`

Pages:
- `index.html` — upcoming events in a single chronological list (nearest date first)
- `past.html` — searchable event archive
- `news.html` — cycling news and announcements
- `suggest-event.html` — public community form for sending event tips for manual review
- `admin.html` — private token-protected dashboard for reviewing suggestions and managing calendar events

The site uses plain HTML, CSS and JavaScript. No build step or frontend framework is required. The event calendar is rendered as one list, sorted by start date with the nearest event first. The Where We Look directory is a single-column list of cycling sources and public social-platform entry points. Event and news cards are loaded from `data/events.json` and `data/news.json`. The browser can optionally use a Cloudflare Worker API by setting `window.IRC_CONFIG.apiBase` in the page HTML.

## Launch dataset

Three upcoming events were checked against their official event pages on 4 November 2026:
- Bajaj Pune Grand Tour 2027 — 26–31 January 2027. Official website: https://punegrandtour.in/
- Tour of Thekkady 2027 — 30 January 2027. Official website: https://www.tourofthekkady.com/ and registration: https://www.novarace.in/events/tour-of-thekkady-2027
- Race Across India 3.0 — starts 28 February 2027, 4,100+ km from Srinagar to Kanyakumari. The organiser's page includes a registration form, but some text on the page refers to older editions; riders should confirm current fees and terms before registering: https://raceacrossindia.org/rain-3-0/

Two past-event entries are clearly labelled as transcribed from the community-admin PDF screenshots. Their original post URLs were not visible in the supplied screenshots. The website does not pretend those missing links exist. Official event-page visuals are shown as previews where available; they are not labelled as posters unless a true poster URL is confirmed.

## What works in the static release

- Three separate, responsive pages with shared navigation and Material 3-style components.
- Upcoming/past event separation based on event end date.
- Search and filters for events, archive year and news.
- Original source and registration/contact links where confirmed.
- Dark/light theme preference.
- Honest poster placeholders when an original poster URL was not confirmed.
- Newsletter form correctly reports that it is not connected until a backend URL is configured. It does not claim to subscribe people without sending a confirmation email.

## Community event suggestions

The fourth page, suggest-event.html, lets visitors send any information they have: an event name, public Facebook/Instagram/LinkedIn/BookMyShow or organiser link, source platform, start/end dates, city, cycling category, organiser, organiser mobile/email, poster/image URL, free-text notes and optional contributor contact details. Most fields are optional; at least one useful event clue is required.

Suggestions are saved as pending in the Cloudflare D1 event_suggestions table. They are NOT published automatically. The administrator signs in at `admin.html` using `ADMIN_API_TOKEN`, checks the source, then approves a suggestion into the Cloudflare events table or rejects it. The admin dashboard can also add, edit and hide calendar events. The public event list combines the published `data/events.json` snapshot with Cloudflare-managed records; Cloudflare records override matching event IDs, and hidden records remove matching events from the public list.

Optional admin notification: set the Worker secret ADMIN_EMAIL to the address that should receive new suggestion notices. The Worker stores the suggestion first; an email notification failure does not delete the suggestion.

Manual review:
- Open `https://indiaracingcycles.github.io/IndiaRacingCycles/admin.html` and enter the `ADMIN_API_TOKEN` Worker secret. The dashboard keeps the token in page memory only; it is not saved to local or session storage.
- The dashboard lists pending/all suggestions, allows manual review and rejection, and approves a suggestion into the Cloudflare events table.
- The Calendar tab can add, edit and hide/restore events. Edits are saved as Cloudflare D1 overrides, so the source `data/events.json` file remains unchanged.
- Protected endpoints: GET `/api/admin/event-suggestions`, PATCH `/api/admin/event-suggestions/{id}`, POST `/api/admin/event-suggestions/{id}/approve`, GET `/api/admin/events`, and POST `/api/admin/events`.

## Daily collection automation

The repository workflow at `.github/workflows/india-racing-cycles-daily.yml` runs once daily. The Python collector:
1. Reads configured public source pages and Google News RSS search feeds.
2. Adds cycling-relevant RSS headlines with the original link and publisher.
3. Can use Gemini to extract event/news candidates from fetched source pages.
4. Requires a source URL and date for an event; uncertain changes are sent to a review queue instead of being published.
5. Keeps existing curated entries and avoids duplicate links/IDs.

### Required GitHub Actions secrets for AI extraction

- `GEMINI_API_KEY` — Gemini API key. Without it, the RSS headline collector still runs, but AI extraction from web pages is skipped.
- Optional `IRC_ADMIN_EMAIL` — recipient for a future review digest. No review email is sent by the current static collector.

The workflow only updates JSON files when content changes. It does not log API keys.

**Important source access:** Facebook Groups, most Instagram content and LinkedIn posts do not provide unrestricted public read APIs. This project uses permitted public pages, RSS and search feeds. Do not add browser-login cookies or bypass access controls. For Meta/LinkedIn integrations, use only approved API access and required permissions.

## Cloudflare Worker backend (newsletter + database)

The Worker source is in `worker/`. It provides:
- `GET /api/events` and `GET /api/news`
- `POST /api/subscribe` — sends a double opt-in confirmation email
- `GET /api/confirm?token=...` — activates a subscriber
- `GET /api/unsubscribe?token=...` — unsubscribes a confirmed recipient
- `POST /api/admin/newsletter` — sends a newsletter to confirmed subscribers (requires a secret)

### Deploy backend

1. Install Node.js and Wrangler: `npm install -g wrangler`.
2. Create a Cloudflare D1 database named `india-racing-cycles`.
3. Copy its database ID into `worker/wrangler.toml`.
4. Run `wrangler d1 execute india-racing-cycles --remote --file worker/schema.sql`.
5. From the `india-racing-cycles/worker` folder, run `wrangler deploy`.
6. Set Worker secrets: `wrangler secret put RESEND_API_KEY`, `wrangler secret put FROM_EMAIL`, `wrangler secret put SITE_URL`, and `wrangler secret put ADMIN_API_TOKEN`. Also set `wrangler secret put ADMIN_EMAIL` for new event suggestion notifications.
7. Set `window.IRC_CONFIG.apiBase` in each HTML page to the deployed Worker URL.
8. Configure the Worker route/allowed origin for the GitHub Pages site and test confirmation and unsubscribe from a real mailbox.

The database ID and secrets are intentionally blank/not committed. Re-run the schema migration after updating this project: `wrangler d1 execute india-racing-cycles --remote --file worker/schema.sql`. Do not put API keys in frontend JavaScript or this public repository.

## Newsletter and monthly report

The Worker stores subscription status, confirmation and unsubscribe tokens. Only confirmed subscribers receive admin newsletter sends. A production sender domain must be verified with Resend before emails can be delivered reliably.

The monthly report can be produced from the generated JSON plus GitHub Actions run history. The initial build does not send a monthly report because no admin email or delivery channel has been configured.

## Manual test

Open the three HTML pages locally or from GitHub Pages. Test search, category/state filters, archive year filter, news filter and theme toggle. Check the original event source links. Newsletter submission should show a setup-required message until the Worker is deployed and configured.

## Source directory

- Cycling Federation of India: https://www.cfiindia.in/
- CFI event calendar: https://www.cfiindia.in/about-3
- Odisha Cycling Association events: https://odishacyclingassociation.in/events/
- Indian Cycling News: https://indiancyclingnews.com/
- Orisports: https://www.orisports.com/
- Bajaj Pune Grand Tour: https://punegrandtour.in/
- Tour of Thekkady: https://www.tourofthekkady.com/

Always check the organiser's latest notice before travel or payment.

## Event tip submissions

The public Suggest an Event page uses a simple prompt-style form. Visitors can submit a short description, a public event link, an image (JPG, PNG or WebP), or any combination. The browser compresses uploaded images before sending them to the Worker. Attachments are stored with the pending suggestion in D1 and displayed in the private admin review queue. They are evidence for review only; they are not automatically published as event posters. Every submission remains pending until an administrator checks the source and completes the event details.
