# Stitch authentication design implementation

Implemented locally, 31 October 2026. The existing React application and all secure teacher onboarding changes were preserved.

## Design sources

Archive: `stitch_iupc_academy_diagonal_portal.zip`.

Inspected the exported `code.html` and `screen.png` for:

- `iupc_academy_desktop_login_screen`
- `iupc_academy_mobile_login_screen`
- `iupc_academy_password_recovery`
- `iupc_academy_teacher_account_activation`

Also inspected `academic_prestige/DESIGN.md`, `iupc_logo.png/screen.png` and the original diagonal-layout reference `image.png/screen.png`. CSS is embedded in the HTML exports. The archive was extracted safely beneath `.local-migration/stitch-reference/` for reference, with path traversal checks; exported scripts/CDNs were not added to the app.

The ZIP logo uses a different lockup from the existing Academy logo. It was not adopted. The login uses the existing official `public/iupc-wordmark.png` as its unauthenticated fallback, preserving any school logo supplied by the existing backend. No logo was invented, redrawn or replaced. The existing fallback is a small raster asset; a higher-resolution official source would improve sharpness at desktop size.

## Frontend files changed

- `src/pages/Login.tsx`: presentation markup/classes, official logo fallback, white branding, mission/philosophy, crimson form, responsive diagonal layout and accessible activation disclosure.
- `src/components/BackendSetup.tsx`: presentation of existing recovery controls and password setup/success/error form; dialog labeling and keyboard focus containment. Invitation logic and all Auth guards, handlers, minimum password length and logout behavior are preserved.
- `src/index.css`: scoped authentication styles and responsive breakpoints. Dashboard/marks styles and global brand tokens are unchanged.
- `scripts/verify-auth.mjs`: responsive UI assertions, local screenshots, visibility-toggle checks and dialog keyboard navigation checks added to the existing mocked Auth regression suite.
- This result document. Production `dist/` artifacts were regenerated.

No dependencies, new external fonts or runtime Stitch code were added. The design uses the existing Tailwind/CSS setup, current Inter stack, local serif fallbacks and Lucide icons.

## Screens and responsive behavior

Login, invalid-link/errors, existing recovery controls, teacher activation guidance and the invitation/recovery password-setup dialog share the new presentation. The password-setup screen still appears only after the existing authenticated callback checks. Activation guidance still sends no invitation request and uses no public `signUp()`.

Desktop/tablet landscape (960px and above) uses a white/crimson diagonal split with centrally positioned branding. Smaller tablet/phone layouts stack a compact white branding section above the form with a subtle diagonal transition. Inputs use 16px text, controls have touch targets of at least 44px where tested, focus indicators are visible, and the page scrolls naturally on short screens. No role selectors, accreditation/security badges, statistics, academic-year labels, vendor credits, background patterns or unsupported authentication options were imported.

## Verification

- Application TypeScript: PASS.
- Production build and PWA generation: PASS; existing non-blocking bundle-size/config-loader warnings remain.
- Existing focused suite: **129 tests passed across 8 files**, including the secure teacher activation implementation.
- Mocked browser suite: **9 scenario groups passed**, including responsive UI at **320, 390, 768, 1024 and 1440px**; official fallback image loading; no horizontal overflow; compact mobile branding; diagonal treatments; password show/hide; recovery/activation controls; keyboard navigation and setup-dialog focus containment. Existing administrator/teacher login, invitation/password setup, retry/failure, recovery, invalid-link and school-role checks remain in the suite.
- Screenshots reviewed locally: `.local-migration/auth-ui-previews/login-1440.png`, `login-768.png`, `login-390.png`, `activation-390.png`, `recovery-390.png`, `password-setup.png`.

All Auth/REST/function responses in browser tests are fictional and external requests are blocked. No real emails/accounts, hosted settings, migrations, RLS, roles, deployed functions, production records or Git operations were changed. The server-side identity protections, dashboards and offline marks functionality were not edited.

## Remaining limits

### Final visual polish

The diagonal geometry and white/crimson colors are preserved. Desktop padding and branding gaps now adapt to shorter viewport heights; the logo is displayed at a more balanced size without editing its pixels. Teacher activation is more compact while retaining a 44px control. The native wordmark dimensions are correctly declared as 174×71. Asset inspection confirmed that larger PWA images are generated derivatives, not higher-resolution Academy lockups; the official wordmark remains the best matching asset available.

TypeScript, production/PWA build and all nine mocked authentication browser scenario groups passed after polishing. The responsive regression now covers 11 viewport combinations, including 1280×600, 1280×720, 1366×768, 1440×650, 1440×900 and 1920×1080. At tested desktop heights of 600px and above, the default login, activation control and footer fit without vertical scrolling. Phones, portrait tablets and very short windows retain natural scrolling; expanded help is not clipped. The exact mission and philosophy text and all authentication handlers are unchanged. Compact desktop preview: `.local-migration/auth-ui-previews/login-1280x600.png`.

Hosted SMTP, Auth URL configuration, registration disablement, administrator provisioning and approved deployment of the existing staff function remain separate tasks from the earlier onboarding report. This visual implementation does not establish live email delivery or production readiness. No public invitation-request endpoint or simulated working activation form was introduced.
