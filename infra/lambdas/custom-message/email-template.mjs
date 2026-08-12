/**
 * Copy and HTML for the two Cognito emails `index.mjs` rewrites: the admin-invite (temporary
 * password) message and the self sign-up confirmation code — each in whichever language the
 * recipient's `custom:inviteLocale` attribute names, falling back to English.
 *
 * Split from `index.mjs` so that file stays the trigger's plumbing (which message type, where the
 * app URL and the locale come from, failure handling) and this one is the content. Still plain
 * `.mjs` with no imports — the whole asset must remain buildable by nothing.
 *
 * ## Why the markup looks like 2005
 *
 * Email is not the web. Outlook renders with Word's engine, Gmail strips `<style>` blocks, and no
 * client can be relied on for flexbox, grid or external stylesheets. So: layout in tables, every
 * style inline, and nothing that degrades into an unreadable mess when a client ignores half of it.
 *
 * ## Deliverability is a content property, not just a sender property
 *
 * A prettier email that trips spam heuristics is worse than the plain one it replaced. The rules
 * this template follows, each one a documented signal:
 *
 * - **Link text is the destination.** Anchor text that hides where it goes (`click here`, or a label
 *   over a different URL) is one of the strongest phishing heuristics there is. The URL is shown in
 *   full and links to exactly itself.
 * - **One link, one domain, and omitted rather than broken.** Multiple destinations read as a
 *   campaign, not a transaction — and a call-to-action label with nothing behind it (before the app's
 *   URL is known) reads as a broken email, worse than one that simply doesn't mention where to go.
 * - **No images at all.** Not blocked, not a tracking-pixel shape, no "download images to read this".
 * - **No hidden text.** That rules out the usual preheader trick, white-on-white text — a spam
 *   signal, and dishonest in a security email.
 * - **It says why you got it.** Legitimate transactional mail explains the trigger, and it stops the
 *   recipient treating an unfamiliar-sender password/code email as an attack.
 * - **Plain register.** No urgency, no exclamation marks, no capitalised words, no "act now".
 *
 * ## Colours
 *
 * Every cell sets both background and foreground. Clients that force dark mode invert what they
 * find, and a rule that sets only one of the two is how you get black text on a black card.
 */

/** Must match `SUPPORTED_LOCALES` in the BFF's admin.ts and the frontend i18n core. */
export const SUPPORTED_LOCALES = ['en-US', 'pt-BR']
export const BASE_LOCALE = 'en-US'

/**
 * `{username}` and `{####}` are Cognito's own placeholders — it substitutes the username and the
 * temporary password/code when it sends. Losing `{####}` from the invite copy sends a password-less
 * email; losing it from the verification copy sends a code-less one.
 */
const COPY = {
  'en-US': {
    invite: {
      subject: 'Your {app} access',
      greeting: 'Hello {username},',
      intro: 'An administrator created an account for you. Use this temporary password to sign in.',
      codeLabel: 'Temporary password',
      note: 'You will be asked to choose your own password the first time you sign in.',
      ctaLabel: 'Sign in at',
      why: 'You received this message because an account was created for you at {app}. If you were not expecting it, you can ignore this email.',
    },
    verify: {
      subject: 'Confirm your {app} account',
      intro: 'Confirm your email to finish creating your account.',
      codeLabel: 'Verification code',
      note: 'Enter this code where you signed up. It expires shortly, so use it soon.',
      ctaLabel: 'Sign in at',
      why: 'You received this message because someone signed up for {app} with this email address. If that was not you, you can ignore this email.',
    },
  },
  'pt-BR': {
    invite: {
      subject: 'Seu acesso ao {app}',
      greeting: 'Olá {username},',
      intro: 'Um administrador criou uma conta para você. Use esta senha temporária para entrar.',
      codeLabel: 'Senha temporária',
      note: 'Você vai escolher sua própria senha no primeiro acesso.',
      ctaLabel: 'Acesse em',
      why: 'Você recebeu esta mensagem porque uma conta foi criada para você no {app}. Se não esperava por isso, pode ignorar este e-mail.',
    },
    verify: {
      subject: 'Confirme sua conta no {app}',
      intro: 'Confirme seu e-mail para concluir a criação da conta.',
      codeLabel: 'Código de verificação',
      note: 'Digite este código onde você se cadastrou. Ele expira em breve — use logo.',
      ctaLabel: 'Acesse em',
      why: 'Você recebeu esta mensagem porque alguém se cadastrou no {app} com este endereço de e-mail. Se não foi você, pode ignorar esta mensagem.',
    },
  },
}

/**
 * Narrows a language tag onto a catalog: exact match, then primary subtag, then English. Mirrors
 * `resolveLocale` in the frontend i18n core, kept separate because this file must stay
 * dependency-free.
 */
export function resolveLocale(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return BASE_LOCALE

  const wanted = tag.trim().toLowerCase()

  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === wanted)
  if (exact) return exact

  const primary = wanted.split('-')[0]
  const byLanguage = SUPPORTED_LOCALES.find((locale) => locale.split('-')[0].toLowerCase() === primary)

  return byLanguage ?? BASE_LOCALE
}

/** Values reaching the HTML come from our own config, but this is markup — escape anyway. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// System stack: no webfont to fetch, and it looks native everywhere instead of falling back to Times.
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji'"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

const INK = '#18181b'
const MUTED = '#52525b'
const LINE = '#e4e4e7'
const CANVAS = '#f4f4f5'
const CARD = '#ffffff'

const cell = (content, extra = '') =>
  `<td style="padding:0 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};background-color:${CARD};${extra}">${content}</td>`

/** The card/table chrome every email shares. */
function renderShell(rows) {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CANVAS};margin:0;padding:24px 12px;">`,
    '<tr><td align="center">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:${CARD};border:1px solid ${LINE};border-radius:10px;">`,
    ...rows,
    '</table>',
    '</td></tr>',
    '</table>',
  ].join('')
}

const heading = (app) =>
  `<tr>${cell(`<strong style="font-size:17px;">${app}</strong>`, 'padding-top:32px;padding-bottom:20px;')}</tr>`

const codeBlock = (label, code) =>
  `<tr>${cell(
    `<div style="font-family:${FONT};font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};padding-bottom:6px;">${label}</div>` +
      `<div style="font-family:${MONO};font-size:20px;font-weight:600;color:${INK};background-color:${CANVAS};border:1px solid ${LINE};border-radius:6px;padding:14px 16px;">${code}</div>`,
    'padding-bottom:20px;',
  )}</tr>`

/** Omitted entirely when no URL is known — see the deliverability note above. */
function ctaRow(label, appUrl) {
  const url = typeof appUrl === 'string' ? appUrl.trim() : ''
  if (!url) return ''

  const safe = escapeHtml(url)
  return `<tr>${cell(
    `${label} <a href="${safe}" style="color:#2563eb;text-decoration:underline;">${safe}</a>`,
    'padding-bottom:28px;',
  )}</tr>`
}

const footer = (text) =>
  `<tr>${cell(`<div style="border-top:1px solid ${LINE};"></div>`, 'padding-bottom:16px;')}</tr>` +
  `<tr>${cell(`<span style="color:${MUTED};">${text}</span>`, 'font-size:13px;line-height:1.5;padding-bottom:32px;')}</tr>`

/** Renders the admin-invite (temporary password) email in the resolved locale. */
export function renderInviteEmail({ locale, appName, appUrl } = {}) {
  const copy = COPY[resolveLocale(locale)].invite
  const app = escapeHtml(appName || 'the app')
  const fill = (text) => text.replace('{app}', app)

  const rows = [
    heading(app),
    `<tr>${cell(copy.greeting, 'padding-bottom:12px;')}</tr>`,
    `<tr>${cell(fill(copy.intro), 'padding-bottom:20px;')}</tr>`,
    codeBlock(copy.codeLabel, '{####}'),
    `<tr>${cell(`<span style="color:${MUTED};">${copy.note}</span>`, 'font-size:14px;padding-bottom:24px;')}</tr>`,
    ctaRow(copy.ctaLabel, appUrl),
    footer(fill(copy.why)),
  ]

  return renderShell(rows)
}

/** Subject and body for one invite. */
export function buildInviteMessage(locale, appName, appUrl) {
  const copy = COPY[resolveLocale(locale)].invite

  return {
    subject: copy.subject.replace('{app}', appName || 'the app'),
    body: renderInviteEmail({ locale, appName, appUrl }),
  }
}

/** Renders the self sign-up confirmation email in the resolved locale. */
export function renderVerificationEmail({ locale, appName, appUrl } = {}) {
  const copy = COPY[resolveLocale(locale)].verify
  const app = escapeHtml(appName || 'the app')
  const fill = (text) => text.replace('{app}', app)

  const rows = [
    heading(app),
    `<tr>${cell(copy.intro, 'padding-bottom:20px;')}</tr>`,
    codeBlock(copy.codeLabel, '{####}'),
    `<tr>${cell(`<span style="color:${MUTED};">${copy.note}</span>`, 'font-size:14px;padding-bottom:24px;')}</tr>`,
    ctaRow(copy.ctaLabel, appUrl),
    footer(fill(copy.why)),
  ]

  return renderShell(rows)
}

/** Subject and body for one confirmation code. */
export function buildVerificationMessage(locale, appName, appUrl) {
  const copy = COPY[resolveLocale(locale)].verify

  return {
    subject: copy.subject.replace('{app}', appName || 'the app'),
    body: renderVerificationEmail({ locale, appName, appUrl }),
  }
}
