# Landing site — mdtask

The Rejudge landing site has an English page at `rejudge.syabro.com` and a Russian page at `rejudge.syabro.com/ru/`.

# Tasks

- [x] SITE-080 Record and embed the real Rejudge demo		#public-release
  The first screen shows a real Rejudge run instead of the temporary demo.

  DoD: the run is recorded with asciinema and embedded into the first screen; the temporary demo and TODO caption are removed.

  **Implemented:**
  - the first screen plays a self-hosted recording of a real Rejudge review
  - the temporary transcript and placeholder caption are removed
  - the recording works on both language routes and mobile layouts

- [ ] SITE-081 Review the landing page before publication		#public-release
  A new user can understand the English landing page, and both desktop and mobile layouts work correctly.

  User decisions:
  - review and fix the English page first
  - check the Russian page only for layout problems
  - keep the Russian text unchanged

  DoD: the English page is reviewed as a new user on desktop and mobile, identified problems are fixed, and the Russian layout is checked without changing its text.

- [ ] SITE-082 Deploy and verify the landing page		#public-release
  Production serves the current verified site build.

  DoD: the site is built and deployed; `https://rejudge.syabro.com/` and `https://rejudge.syabro.com/ru/` load and match the current build.

- [ ] SITE-083 Translate and review the Russian landing page		#public-release @blocked_by:SITE-081
  The Russian page matches the final English page in meaning and reads naturally in Russian.

  Translate the approved English copy after `SITE-081` is complete. Review the whole Russian page for missing text, mistranslations, inconsistent terms, and unnatural wording.

  User decision: replace the current Russian copy with a translation of the finalized English version.

  DoD: every user-facing English text has a Russian counterpart, both versions describe the same product behavior, and the Russian page passes a full language review.
