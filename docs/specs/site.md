# Landing site — mdtask

The Rejudge landing site has an English page at `rejudge.syabro.com` and a Russian page at `rejudge.syabro.com/ru/`.

## Content

The first screen explains Rejudge's purpose and shows a real review. User outcomes come before implementation details. The copy stays within the product's actual contract, uses consistent terminology, and has the same meaning in English and Russian.

## Review diagram

Each reviewer gives the judge a separate conclusion. The judge can return follow-up questions to reviewers. The answer is visually separate as the output of the process, while the Run ID has secondary weight and explains how to continue the review. The mobile diagram preserves the same flow vertically, including the judge's follow-up loop.

## Installation instructions

The primary path starts with one global Rejudge installation that serves the standalone CLI and Pi. Pi users invoke `/rejudge`. Installation, configuration, authentication, and model instructions match the released CLI and Pi behavior.

## Layout

Both language routes support desktop, 375 px, and 320 px layouts without horizontal overflow.

## Deployment

`just site-deploy` deploys the site to the Cloudflare Pages project `rejudge`. After deployment, verify `https://rejudge.syabro.com/` and `https://rejudge.syabro.com/ru/`.

# Tasks

- [x] SITE-080 Record and embed the real Rejudge demo		#public-release
  The first screen shows a real Rejudge run instead of the temporary demo.

  DoD: the run is recorded with asciinema and embedded into the first screen; the temporary demo and TODO caption are removed.

  **Implemented:**
  - the first screen plays a self-hosted recording of a real Rejudge review
  - the temporary transcript and placeholder caption are removed
  - the recording works on both language routes and mobile layouts

- [x] SITE-081 Review the landing page before publication		#public-release
  A new user can understand the English landing page, and both desktop and mobile layouts work correctly.

  User decisions:
  - review and fix the English page first
  - check the Russian page only for layout problems
  - keep the Russian text unchanged

  DoD: the English page is reviewed as a new user on desktop and mobile, identified problems are fixed, and the Russian layout is checked without changing its text.

  **Implemented:**
  - the English first screen now explains the reviewer-and-judge flow directly
  - the Quick start identifies `/login` as a Pi command and explains the reasoning-level tradeoff
  - code remains readable in dark mode
  - English and Russian layouts were verified at desktop, 375 px, and 320 px without changing the Russian copy

- [x] SITE-082 Deploy and verify the landing page		#public-release
  Production serves the current verified site build.

  DoD: the site is built and deployed; `https://rejudge.syabro.com/` and `https://rejudge.syabro.com/ru/` load and match the current build.

  **Implemented:**
  - `just site-deploy` targets the Cloudflare Pages production branch
  - the immutable deployment and both custom-domain routes serve the current English and Russian pages
  - desktop, 375 px, and 320 px layouts preserve the complete review flow without horizontal overflow

- [x] SITE-083 Translate and review the Russian landing page		#public-release
  The Russian page matches the final English page in meaning and reads naturally in Russian.

  Translate the approved English copy after `SITE-081` is complete. Review the whole Russian page for missing text, mistranslations, inconsistent terms, and unnatural wording.

  User decision: replace the current Russian copy with a translation of the finalized English version.

  DoD: every user-facing English text has a Russian counterpart, both versions describe the same product behavior, and the Russian page passes a full language review.

  **Implemented:**
  - the Russian page now matches the final English copy, including Run ID continuation, Pi login, and reasoning-level behavior
  - the translation uses consistent product terms without narrowing Rejudge to code review or promising a trustworthy answer
  - the Russian layout works at desktop, 375 px, and 320 px

- [ ] SITE-084 Make the landing-page recording explain a complete review
  The landing-page recording shows how Rejudge starts, what request it reviews, and what answer it returns, so a new user can follow the complete run.

  The current recording shows activity without enough context: the launch action is missing, the request appears without a clear source, and the final Rejudge answer is not visible. Replace it with a recording that presents the full user flow.

  User decision: before recording, agree with the user on the complete recording scenario and exact prompt, including what the run tests and how that test is demonstrated.

  DoD:
  - the recording scenario and exact prompt are approved by the user before recording
  - the agreed scenario states what the review tests and how the result demonstrates it
  - the recording visibly shows how Rejudge is launched
  - the request is readable and clearly shown as user input
  - the final Rejudge answer is shown long enough to understand the result
  - a first-time viewer can follow the complete flow without surrounding explanation
  - the new recording replaces the current one on both language routes and remains readable on desktop and mobile
