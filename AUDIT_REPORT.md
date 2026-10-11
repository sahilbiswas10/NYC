# NYC LMS audit — 10 October 2026

## Summary

Audited the existing application and made focused fixes. The HTML/CSS/vanilla JavaScript frontend, Express/Mongoose backend, self-hosted FFmpeg/HLS pipeline, layout, colors, animations, and course entry flows are preserved.

The reported Dashboard → Courses → Home redirect was **not reproduced** in the current code. Actual browser checks cover all three roles reaching Courses and returning with browser Back. Ordinary course links still open Preview & Reviews; student dashboard links open Curriculum. A separate verified navbar failure with malformed cached user JSON was fixed.

## Significant fixes and evidence

| Problem and root cause | Changed files | Verification |
| --- | --- | --- |
| Malformed cached user JSON left navigation empty because rendering stopped inside a caught parse error. | `frontend/js/navbar.js` | Regression tests exercise malformed/null storage and all role destinations; actual browser navigation and Back pass. |
| Short-lived HLS tickets could be reused as API login tokens. Cookie parsing could also fail on unrelated malformed values. | `backend/middleware/auth.js`, `backend/middleware/streamAuth.js` | Session/ticket separation, malformed cookies, and token replay tested; HTTP authorization covers guest, unenrolled/enrolled student, owning/other instructor, and admin. |
| Segment delivery allowed filenames outside generated HLS output and did not check canonical paths against symlink escapes. | `backend/controllers/streamController.js`, `backend/utils/queueManager.js`, `backend/workers/mediaProcessor.js` | Traversal, arbitrary filenames, escaped symlinks, and unsafe recovery paths rejected; real manifests and segments play in Chromium. |
| Media permissions used only the first lesson placement, denying legitimate access to reused media. | `backend/utils/mediaAccess.js` | Shared course ownership/enrollment and published demo placement tested; private lesson access remains restricted. |
| A timer could delete a finished standalone upload before its instructor attached it. Cleanup also had a stale processing-state race. | `backend/utils/queueManager.js`, `backend/utils/mediaCleanup.js`, `backend/controllers/mediaController.js` | Standalone uploads retained, explicit detach cleanup deferred, shared/referenced files preserved, and raced deletions return conflict. Concurrency limits retained and tested. |
| Cancellation before FFmpeg spawned could leave the transcode running. Original paths needed canonical checks. | `backend/workers/mediaProcessor.js` | Startup cancellation and original symlink rejection regressions pass; actual video/audio transcoding passes. |
| Course creation could accept another instructor's demo. Publishing could accept missing media or empty written lessons. | `backend/controllers/courseController.js` | Failures reproduced before fixes; draft creation remains available; valid mixed curriculum publishes through HTTP and the existing browser forms. |
| Rejected notes uploads and bulk course deletion could leave notes files behind. | `backend/controllers/moduleController.js`, `backend/models/Course.js` | Real rejected-upload and course-deletion checks pass; validated notes names and surviving shared references are protected. |
| Admin user deletion returned HTTP 500: installed Mongoose requires an explicit option for the course count update pipeline. | `backend/routes/adminRoutes.js` | Mongoose regression failed before the one-option fix; real HTTP deletion now clears test enrollment/progress/review/discussion data and updates counts. |
| Completion calculations counted optional lessons; stale enrollment status could issue a certificate. Repeated reads/writes saved unchanged enrollment state. | `backend/utils/courseProgress.js`, `backend/routes/progressRoutes.js`, `backend/routes/courseRoutes.js`, `backend/routes/certificateRoutes.js`, `frontend/js/course.js`, `frontend/js/player.js` | Required/optional/legacy lessons, revoked enrollment, stale certificates, MongoDB persistence, completion ticks, and optional Continue Watching tested. Backend completion governs certificate access. |
| Instructor previews started student progress tracking, producing misleading permission errors. | `frontend/js/player.js` | Role regressions pass; actual instructor preview makes no student progress writes. Student playback/completion remains unchanged. |
| Certificate QR library URL returned 404. | `frontend/certificate.html` | Existing QR library browser URL corrected; actual rendered QR scanning and print checks are included in browser validation. No layout change. |
| Password changes could exceed bcrypt's 72-byte input limit. | `backend/controllers/authController.js` | UTF-8 byte-limit regression passes; existing password update API preserved. |

## Tests

- `npm test`: **101/101 pass**, comprising focused regressions and real isolated HTTP/MongoDB/FFmpeg workflows. Node's total includes the integration parent test.
- `npm run test:e2e`: **22/22 pass**, including the same isolated HTTP checks plus 11 actual browser workflow steps in Chromium `154.0.8037.57`. This overlaps the integration coverage in `npm test`; these are not 123 unique tests.
- Browser result: no uncaught JavaScript errors, console errors, or failed resources. Playback resumed from the saved 0.610-second position. The displayed canvas QR decoded to its exact verification URL, public verification succeeded, and the printed PDF contained **one page**.
- `node --check`: all 31 changed/new JavaScript files pass; `package.json` parses.
- `git diff --check`: passes.

The previous `npm test` was a failing placeholder. The old end-to-end scripts either simulated an upload or used hardcoded credentials against the normal server and could exit successfully after errors. They now run isolated checks and propagate failures. Setup and commands are documented in `README.md`.

## Feature status

| Feature | Status | Exercised behavior |
| --- | --- | --- |
| Navigation | PASS | Role dashboards → Courses, browser Back, course tabs, search/filters, and local link destinations. |
| Authentication | PASS | Registration/login validation, role assignment protection, session cookies/bearers, expired-token redirects, and scoped-ticket replay rejection. |
| Role authorization | PASS | Six-role/access states checked through real protected APIs and streaming requests. |
| Course authoring | PASS | Existing instructor forms create/edit, preview, save, and publish; ownership/admin API rules checked. |
| Modules and lessons | PASS | CRUD, ordering, ownership, written content, and media attachment. |
| Enrollment | PASS | Real free enrollment button/API, duplicate rules, revocation, restoration, and paid-course free-enrollment rejection. Successful paid checkout is not tested. |
| Video upload | PASS | Real generated MP4 upload → FFmpeg → ready; invalid and oversized uploads rejected. |
| Audio upload | PASS | Real generated WAV upload → FFmpeg → ready → HLS playback. |
| FFmpeg processing | PASS | Actual video/audio jobs, failure validation, startup cancellation regression, and queue limit checks. |
| HLS streaming | PARTIAL | Actual Chromium playback and HTTP bearer/cookie requests pass; native Safari playback unavailable. |
| Student playback | PASS | Real generated video/audio play and finish in Chromium. |
| Progress tracking | PASS | Playback pause saves MongoDB progress; student-only writes and required completion tested. |
| Continue Watching | PASS | Dashboard resumes the correct saved lesson and approximate time; unfinished optional lessons remain available. |
| Course completion | PASS | Required video/audio/text completion updates backend status and UI ticks; incomplete/revoked certificates rejected. |
| Media cleanup | PARTIAL | Intended-file, reference, course deletion, processing race, and deferred cleanup cases pass. Restart durability of deferred cleanup remains a limitation. |

## Safety and remaining limitations

- Baseline working tree was clean at `770020a`. No Git reset, commit, or push was performed.
- No real `.env`, credentials, Atlas database, users, uploads, or running server were used for tests. Each integration run used a temporary application copy, separate local MongoDB process, generated media, and test accounts, then removed its own fixtures.
- No database migrations, production deployments, or storage moves were made. No npm dependencies or lockfile changed. Test scripts changed; the existing browser QR script now uses the available `qrcode@1.5.1` build instead of the missing `1.5.4` build.
- Actual Safari/native HLS and long background playback are **NOT TESTED**. Native-cookie access and ticket renewal/retry behavior have HTTP/unit coverage, not a Safari session.
- Successful Razorpay checkout is **NOT TESTED** because provider credentials were deliberately excluded. Paid-course access guards pass; no external payment requests were made.
- Deferred deletion intent is held in memory. Restarting during processing can leave detached media; no bulk cleanup or data migration was attempted. FFprobe cancellation waits for the probe call to finish.
- Replacing a completed lesson's content retains its existing completion record. This existing behavior was preserved; changing that policy would require a product decision.
- Live deployment configuration and existing uploaded files were not validated. Passing generated-media checks does not recover missing historical files.

Restart the local server after reviewing these changes to load the updated backend: stop your existing `npm start` with Ctrl+C, then run `npm start` again.

## UI follow-up — October 10, 2026

Implemented the five requested UI refinements using the existing frontend:

- Reading text uses a lighter system font and sentence-case styling; distinctive display headings remain. This covers descriptions, written lessons, reviews, discussions, and editor text areas.
- The course title uses the overview width. Price and enrollment sit beside the demo on desktop and immediately beneath it on mobile, before the remaining details.
- Admin tools are grouped under Management. The disclosure supports keyboard navigation, Escape, outside dismissal, and the current-page indicator.
- Previous/Next Lesson links follow the saved curriculum order across modules, including optional lessons. Unavailable first/last destinations are disabled; clicking a link does not mark a lesson complete.
- Shorter interaction and entrance timings retain ambient motion and hover effects. The duplicate native page-snapshot transition was removed so it no longer overlaps the existing page fade and entrance animations.

Validation for this follow-up:

- `npm test`: **103/103 pass**.
- `npm run test:e2e`: **22/22 pass**, including **14 actual Chromium browser workflows**. These totals overlap.
- Desktop (1440×900) and mobile (390×844) layout checks cover a long title, price/enrollment placement, both themes, mobile Management, and lesson navigation. Screenshots were visually inspected.
- Browser checks also exercise login, Back navigation, filters, authoring, free enrollment, discussion, HLS video/audio, persisted progress, required completion, QR decoding, and single-page certificate printing.
- No uncaught JavaScript or console errors. One Razorpay SDK resource request was cancelled (`net::ERR_ABORTED`) during browser navigation; successful external checkout remains untested.
- All fixtures were isolated. No backend code, production data, credentials, dependencies, Git commits, or deployments were changed by this UI follow-up. Earlier audit changes remain in the working tree.

Hard-refresh the browser to load these frontend changes. Browser coverage is Chromium with responsive viewports; Safari and physical mobile devices were not exercised.


## Quizzes and notifications follow-up (2026-10-10)

Added versioned quiz definitions, server-side scoring, persisted student results,
module test access rules, admin/instructor quiz editing and JSON import, learner
quiz panels, curriculum completion indicators, and in-app notifications.
Lesson quiz scores do not block the next lesson inside an unlocked module.
Published lesson quizzes still count toward completion, and module tests control
access to subsequent modules. Existing courses acquire requirements when quizzes
are published; no quiz content was generated or published into the database.

Notification support includes a bell/inbox, course changes, quiz results,
discussion replies, and course announcements. Notification ownership is checked
on the server. No email notifications are sent.

Checks: JavaScript syntax checks passed for 25 affected feature files, and
`git diff --check` passed. Automated tests and live browser/database workflows
were not run for this feature. Earlier audit test counts do not validate these
new changes. No commits, deployment, or live data changes were made.

Usage and revision behavior: see `QUIZZES_NOTIFICATIONS.md`.
