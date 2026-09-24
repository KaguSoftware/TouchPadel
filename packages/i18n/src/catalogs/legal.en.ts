/**
 * `legal.*` — the public legal pages (apps/web/app/[locale]/{privacy,terms,support,delete-account}):
 * the App Store Connect Privacy Policy URL and Support URL, the Google Play account-deletion URL,
 * and the Terms of Service the app's consent checkbox points at.
 *
 * Written from what the system actually does — change the copy when the system changes, and bump
 * CURRENT_TERMS_VERSION (packages/core/src/legal/terms.ts) when a guest must agree again.
 *
 * `entity.*` holds the operating company's details. Every legal string can use them as
 * {company}, {tradingName}, {registration}, {address}, {email}, {city} and {minPlayAge}
 * (LegalDocument passes them to every lookup), plus {cancelHours} — the free-cancellation
 * window read live from venue_settings_public, so the terms never contradict the app.
 * Values still reading `[FILL: …]` are for the partner to complete — see
 * docs/legal/LEGAL-DETAILS-TO-FILL.md and scripts/check-legal-placeholders.mjs.
 * The venue phone and hours come from venue_settings_public, never from here.
 */
export const legalEn = {
  lastUpdated: 'Last updated: 23 September 2026',
  version: 'Version {version}',
  entity: {
    company: '[FILL: company legal name]',
    tradingName: 'Touch Padel',
    registration: '[FILL: commercial registration number]',
    address: '[FILL: registered address]',
    email: '[FILL: privacy contact email]',
    city: '[FILL: city whose courts hear disputes]',
    minPlayAge: '[FILL: age]',
  },
  nav: {
    label: 'Related pages',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    support: 'Support',
    deleteAccount: 'Delete account',
    otherLanguage: 'العربية',
  },
  contact: {
    phoneLead: 'Front desk phone:',
    noPhone: 'Contact the front desk at the venue.',
    hours: 'Opening hours',
    emailLead: 'Email:',
    addressLead: 'Address:',
  },
  privacy: {
    title: 'Privacy Policy',
    metaDescription:
      'What the Touch Padel app and website collect, why, who sees it, how long it is kept, your rights, and how to delete your account.',
    intro:
      'This policy explains what information the Touch Padel app, this website and the venue’s systems collect about you, why, who can see it, how long we keep it, and the rights you have over it.',
    who: {
      title: 'Who we are',
      body: '{tradingName} is a padel and café venue in Iraq operated by {company} (“we”, “us”), commercial registration number {registration}, of {address}. We decide why and how your information is used, so we are responsible for it. The Touch Padel app, this website and the venue’s staff systems were built and are maintained for us by Kagu Software, which handles information only on our instructions.',
    },
    collect: {
      title: 'What we collect',
      accountLead: 'Your account.',
      account:
        'Your first name and surname, your phone number, your password, your preferred language and, if you give one, your email address. Your phone number is required. Your password is stored only in hashed form, so nobody at the venue can read it.',
      codesLead: 'Verification codes.',
      codes:
        'When you create an account, reset your password or change your phone number, we send a one-time code to that number — on WhatsApp, or by SMS if it cannot receive WhatsApp — through a messaging provider. We keep a record of each message sent (the number, the time and whether it was delivered) to stop abuse and control cost.',
      bookingsLead: 'Your bookings.',
      bookings:
        'The court, date, time, duration and price, the booking reference, its status (upcoming, played, cancelled or no-show), who made or cancelled it, and any note you or the front desk add to it.',
      cafeLead: 'Café orders from your table.',
      cafe:
        'When you scan a table’s QR code, your browser gets an anonymous session with no name or phone number. We record the table, what you order, any note you add to an item, and when. If you are signed in to an account, your orders can be linked to it.',
      pushLead: 'Notification token.',
      push: 'If you allow notifications, your device gives the app a push token. We store it to send you booking confirmations, reminders, cancellations and no-show notices.',
      providersLead: 'Sign in with Apple or Google (optional).',
      providers:
        'If you choose one of these, we receive your name, your email address and an account ID from that provider. Apple may give us a private relay address instead of your real email. We never receive your Apple or Google password.',
      notesLead: 'Notes the venue keeps.',
      notes:
        'Staff can add short notes and labels to your customer record — for example a birthday, a preference or a payment note — so they can serve you well. Only staff can see them.',
      consentLead: 'Your agreement.',
      consent: 'The version of our Terms of Service and this policy you accepted, and when.',
      technicalLead: 'Security and audit records.',
      technical:
        'Our systems record sign-ins, errors and every change staff make to bookings, orders and payments, with the time and the account or device that made it.',
      notCollected:
        'The app does not collect your location or contacts, and a guest account cannot upload photos: only venue staff accounts can attach work photos, in the app’s staff area. The app has no advertising, no tracking and no third-party analytics or crash reporting. There is no online payment, so we never collect card details.',
      website:
        'This website: the café menu pages can use privacy-friendly analytics (PostHog, hosted in the EU) to count page views. It sets no cookies, keeps only an anonymous identifier in your browser’s storage, never identifies you and does not record your screen. The legal pages do not load it, and the app does not use it.',
    },
    use: {
      title: 'Why we use it, and on what basis',
      lead: 'We use your information only for these purposes. Each has a legal basis:',
      account:
        'creating and running your account and confirming your phone number or email — to perform our agreement with you (the Terms of Service);',
      bookings:
        'taking, showing, changing and cancelling your bookings and café orders, and letting the front desk know who booked and contact you about it — to perform our agreement with you;',
      notify:
        'sending booking confirmations, reminders and changes as notifications — with your consent, which you can withdraw at any time in your device settings;',
      rules:
        'applying the venue’s rules, such as the cancellation window and limits after repeated no-shows, and preventing fraud and abuse — our legitimate interest in keeping courts available and fair;',
      security:
        'keeping the service secure, fixing problems and keeping audit records — our legitimate interest in a safe, reliable service;',
      legal:
        'keeping accounting records and answering lawful requests from authorities — our legal obligations.',
      never: 'We do not use your information for advertising, we do not sell it, and we do not make automated decisions about you that have legal or similarly significant effects.',
    },
    share: {
      title: 'Who can see it',
      staff:
        'Venue staff. Front-desk staff and managers can see your bookings, your name, your phone number and your email address if we have one, and the notes kept about you. Café staff see table orders. Staff access is limited by role and every change is recorded.',
      processorsLead: 'Service providers that run parts of the service for us, only on our instructions and only with what they need:',
      supabase: 'Supabase — database, sign-in and server hosting (Frankfurt, Germany);',
      push: 'Expo, Apple Push Notification service and Firebase Cloud Messaging — delivering notifications to your device;',
      signIn: 'Apple and Google — only if you choose to sign in with them;',
      whatsapp:
        'OTPIQ and Meta (WhatsApp), with Twilio as a possible backup — delivering verification codes by WhatsApp or SMS;',
      telegram:
        'Telegram — café orders (the table, the items and any notes, never your name or phone number) are sent to the venue staff’s private Telegram group so the kitchen and waiters can prepare them;',
      ai: 'an AI service provider (currently Groq; the venue may switch to Anthropic) — the venue owner can ask an assistant questions about bookings and sales. The records needed for an answer are sent to the provider; phone numbers and email addresses are replaced with placeholders first, but names can be included;',
      vercel: 'Vercel — hosting this website;',
      posthog: 'PostHog (EU) — website page-view analytics, as described above;',
      kagu: 'Kagu Software — building, maintaining and supporting the app, the website and the staff systems.',
      authorities:
        'We also disclose information to authorities, courts or professional advisers when the law requires it, or when it is needed to establish or defend a legal claim.',
      noSale:
        'We do not sell your information, share it for advertising, or let anyone use it to track you across other apps or websites.',
    },
    transfers: {
      title: 'Where your information is stored',
      body: 'Our database is hosted in the European Union (Frankfurt, Germany). Some of the providers above — including Vercel, Expo, Telegram, Twilio and the AI provider — may process information in the United States or other countries. We choose providers that protect information under their own security and data-protection commitments, and we send them only what they need.',
    },
    retention: {
      title: 'How long we keep it',
      active: 'We keep your account information for as long as you have an account.',
      deleted:
        'When you delete your account, your login, name, phone number, email address and linked Apple or Google sign-in are removed immediately, and you are signed out on every device. Your notification token, staff notes about you and any notifications waiting to be sent are deleted too.',
      bookings:
        'Bookings and café orders you have already made stay in the venue’s records with no name, phone number or notes attached, because the venue has to keep its own accounts. They can no longer be linked to you. The record that you accepted our terms stays with them, without your name.',
      cafe: 'Anonymous café table sessions end when they expire; the orders stay in the venue’s sales records without a name.',
      logs: 'Café order messages in the staff Telegram group are deleted after 30 days, and records of staff actions in Telegram after 90 days. Audit and security records, and records of verification messages, are kept for as long as they are needed for security, dispute resolution and accounting.',
      apple:
        'If you used Sign in with Apple, deleting your account on an iPhone asks Apple to confirm and then revokes Touch Padel’s access to your Apple ID. You can also remove Touch Padel from the list of apps using your Apple ID in your Apple account settings.',
    },
    rights: {
      title: 'Your rights',
      lead: 'You can:',
      access: 'ask what information we hold about you and get a copy of it;',
      edit: 'see and change your name and phone number in the app under Profile → Edit profile (a new number is confirmed with a code), or ask us to correct anything else;',
      delete: 'delete your account in the app (Profile → Delete account) or on our website, or ask us to delete it;',
      object:
        'object to a use based on our legitimate interests, or ask us to restrict it while a question is settled;',
      notifications: 'turn notifications on or off at any time in your device settings;',
      language: 'change the app language under Profile → Settings.',
      how: 'To use any of these rights, email {email} or ask at the front desk. We may ask you to confirm the account is yours. We answer within 30 days. If you are not satisfied with our answer, you can complain to the competent authority in Iraq.',
      deleteLink: 'Delete your account on the website',
    },
    cookies: {
      title: 'Cookies and browser storage',
      body: 'This website uses one cookie to remember your language, and the cookies needed to keep your café table session and any sign-in working. It uses no advertising or tracking cookies. Page-view analytics keep an anonymous identifier in your browser’s storage, not in a cookie. To turn analytics off in your browser, open any menu page with ?analytics=off added to the end of the address.',
    },
    security: {
      title: 'Security',
      body: 'Information is encrypted in transit, passwords are stored only in hashed form, and staff access is limited by role and recorded. No system is perfectly secure; if a breach puts your information at risk, we will tell you and act to limit the harm.',
    },
    children: {
      title: 'Children',
      body: 'You must be at least 13 to create an account, and if you are under 18 a parent or guardian must agree to it. We do not knowingly collect information from children under 13. If you think a child under 13 has created an account, contact us and we will delete it.',
    },
    changes: {
      title: 'Changes to this policy',
      body: 'If we change this policy, we update this page and the date and version at the top. If the change affects you in a meaningful way, the app asks you to review and accept it the next time you open it.',
    },
    contactSection: {
      title: 'Contact',
      body: 'Questions about this policy or your information? Contact {company}:',
    },
  },
  terms: {
    title: 'Terms of Service',
    metaDescription:
      'The agreement for using the Touch Padel app and website, booking courts and ordering at the venue: bookings, cancellations, venue rules, safety and liability.',
    intro:
      'These terms are the agreement between you and {company} for using the Touch Padel app and this website, booking courts, and ordering at the {tradingName} venue. By creating an account, or by booking or ordering, you agree to them. Please read them.',
    who: {
      title: 'Who we are',
      body: '{tradingName} is operated by {company}, commercial registration number {registration}, of {address}. You can reach us at {email} or at the front desk.',
    },
    accounts: {
      title: 'Your account',
      age: 'You must be at least 13 to create an account. If you are under 18, you confirm that a parent or guardian has agreed to these terms for you.',
      accurate: 'Give your real name and a phone number that is yours, and keep them up to date. One account per person.',
      secure:
        'Keep your password to yourself. Bookings made from your account are your responsibility unless you tell us it has been misused.',
      desk: 'If the front desk created an account for you, these terms apply from the first time you sign in and accept them.',
    },
    bookings: {
      title: 'Bookings',
      confirm:
        'A booking is made when the app or the front desk shows it as confirmed. A time you hold but do not confirm in time is released for others.',
      price:
        'Prices are shown in Iraqi dinars (IQD) before you confirm. Unless the app says otherwise, you pay at the venue — there is no online payment.',
      cancel:
        'You can cancel for free in the app until {cancelHours} hours before your slot. Less than {cancelHours} hours before, only the front desk can change or cancel it.',
      noShow:
        'If you do not come and have not cancelled, the booking may be marked as a no-show. Repeated no-shows may lead us to limit or suspend booking from your account.',
      time: 'Please arrive on time. A slot ends at its scheduled time even if play starts late.',
      venueCancel:
        'We may have to cancel or move a booking — for example for maintenance, safety, a power cut or an event. We will tell you as early as we can and offer you another time or cancel it at no charge.',
    },
    cafe: {
      title: 'Café orders',
      order: 'An order from the menu or a table QR code is a request; it is accepted when staff start preparing it. Items can sell out.',
      allergens:
        'Ingredient and allergen information in the menu is a guide only. If you have an allergy or intolerance, tell the staff before you order.',
      pay: 'You pay at the venue, by the methods it accepts. The bill printed by the till is the one that counts.',
    },
    venue: {
      title: 'Venue rules and your safety',
      risk: 'Padel is a physical sport. Playing carries a risk of injury — from the ball, rackets, the glass walls, other players and falls. You take part at your own risk and only if you are fit to play.',
      rules:
        'Wear suitable sports shoes, follow the posted venue rules and staff instructions, and use the courts and equipment only for padel.',
      minors: 'Children under {minPlayAge} must be supervised by a responsible adult at all times.',
      damage:
        'You are responsible for damage you cause to courts, glass, nets, equipment or furniture, beyond normal wear and tear.',
      belongings:
        'Look after your belongings. We are not responsible for items lost or stolen at the venue unless the loss was caused by us.',
      conduct:
        'We may refuse service to, or ask to leave, anyone who is unsafe, abusive or intoxicated, or who breaks these rules.',
    },
    app: {
      title: 'Using the app and website',
      use: 'Use the app only for your own bookings and orders. Do not make bookings you do not intend to keep, interfere with the service, try to reach other people’s information, or copy or scrape it.',
      availability:
        'We work to keep the app available and correct, but it may sometimes be unavailable or wrong. If the app and the front desk disagree about a booking, we will settle it with you fairly using the venue’s records.',
      ip: 'The app, the website, and the Touch Padel name and logos belong to us or our licensors. You may use them only to use the service.',
    },
    messages: {
      title: 'Messages from us',
      body: 'We send verification codes and, if you allow notifications, messages about your bookings. Any promotional messages are sent only as the law allows, and you can turn notifications off at any time.',
    },
    liability: {
      title: 'Our responsibility to you',
      care: 'We provide the courts, the café and the app with reasonable care and skill.',
      limit:
        'As far as the law allows, we are not responsible for indirect loss, for loss that was not foreseeable, or for loss caused by your own actions, by other players or by events outside our reasonable control. Otherwise, our total responsibility for a booking or an order is limited to the amount paid for it.',
      notExcluded:
        'Nothing in these terms limits our responsibility for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be limited under the law that applies.',
    },
    ending: {
      title: 'Suspending or closing an account',
      body: 'You can delete your account at any time, in the app or on our website. We may suspend or close an account that breaks these terms, is used for fraud, or repeatedly does not show up for bookings. We will tell you why unless the law or safety prevents it.',
    },
    changes: {
      title: 'Changes to these terms',
      body: 'We may update these terms when the service or the law changes. The date and version are shown at the top. If a change affects you in a meaningful way, the app asks you to accept the new version before you continue; if you do not agree, you can stop using the service and delete your account.',
    },
    law: {
      title: 'Law and disputes',
      body: 'These terms are governed by the laws of the Republic of Iraq, including the laws of the Kurdistan Region where they apply. If something goes wrong, please talk to us first — most problems are solved at the front desk. If we cannot resolve it together, the courts of {city} have jurisdiction.',
      language: 'These terms are published in Arabic and English. If the two versions differ, the Arabic version applies.',
    },
    contactSection: {
      title: 'Contact',
      body: 'Questions about these terms? Contact {company}:',
    },
  },
  support: {
    title: 'Support',
    metaDescription: 'Help with booking courts, paying, cancelling and managing your account in the Touch Padel app.',
    intro: 'Help with the Touch Padel app. If you cannot find your answer here, contact the front desk.',
    about: {
      title: 'What the app does',
      body: 'Touch Padel lets you book one of the two padel courts at our venue in Iraq, in 60-minute slots, see your upcoming and past bookings, and get reminders before you play. The app is in English and Arabic.',
    },
    booking: {
      title: 'Booking and paying',
      choose: 'On the Book tab, choose a court, a date and a free time, then confirm.',
      find: 'Your booking appears under My Reservations with its booking reference.',
      pay: 'There is no online payment. You pay at the front desk when you arrive.',
      notify: 'If you allow notifications, you get a confirmation when you book and a reminder before your slot.',
    },
    cancel: {
      title: 'Cancelling',
      free: 'You can cancel for free in the app until {cancelHours} hours before your slot.',
      late: 'Less than {cancelHours} hours before, contact the front desk to change or cancel.',
      noShow:
        'If you do not come and have not cancelled, the venue may mark the booking as a no-show. Repeated no-shows may limit booking in the app.',
      more: 'The full booking rules are in our Terms of Service',
    },
    account: {
      title: 'Account help',
      forgotLead: 'Forgot your password?',
      forgot:
        'On the sign-in screen, tap “Forgot password?”, enter your account’s phone number, and we send a code to that number on WhatsApp or by SMS. Enter the code, then choose a new password.',
      noCodeLead: 'No code arrived?',
      noCode:
        'Codes arrive on WhatsApp, or by SMS if the number has no WhatsApp — check both. If nothing arrives, check the country code and try again.',
      phoneLead: 'Changing your phone number.',
      phone: 'Go to Profile → Edit profile, enter the new number, and confirm it with the code we send to that number.',
      socialLead: 'Signed up with Apple or Google?',
      social: 'Use the same button again to sign in.',
    },
    delete: {
      title: 'Deleting your account',
      how: 'In the app, go to Profile → Delete account and type the confirmation word.',
      what: 'Your account, name and phone number are deleted immediately and you are signed out everywhere. Bookings you have already made stay in the venue’s records with no name attached.',
      desk: 'If you cannot open the app, delete your account on our website, or ask the front desk.',
      web: 'Delete your account on the website',
      more: 'What is deleted and what is kept',
    },
    contactSection: {
      title: 'Contact us',
      body: 'For anything else, contact the Touch Padel front desk.',
    },
  },
  deleteAccount: {
    title: 'Delete your account',
    metaDescription:
      'Delete your Touch Padel account and the personal information linked to it, in the app or on this page.',
    intro:
      'You can delete your Touch Padel account in the app or here on the website. Deletion is permanent and takes effect immediately.',
    inApp: {
      title: 'In the app',
      body: 'Open the Touch Padel app, go to Profile → Delete account, and type the confirmation word.',
    },
    what: {
      title: 'What is deleted and what is kept',
      deleted:
        'Deleted immediately: your login, name, phone number, email address, linked Apple or Google sign-in, notification token, the staff notes about you and any notifications waiting to be sent. You are signed out on every device.',
      kept: 'Kept, without your name: bookings and café orders you have already made, because the venue has to keep its own accounts. They can no longer be linked to you.',
      more: 'Read the full retention details in the Privacy Policy',
    },
    web: {
      title: 'On this website',
      lead: 'Sign in with the phone number or email address and the password of your account, then confirm.',
    },
    form: {
      label: 'Delete your account',
      method: 'Sign in with',
      phone: 'Phone',
      email: 'Email',
      phoneLabel: 'Phone number',
      phonePlaceholder: '0770 123 4567',
      emailLabel: 'Email address',
      passwordLabel: 'Password',
      signIn: 'Sign in',
      signingIn: 'Signing in…',
      signedIn: 'Signed in. This will permanently delete the account for {who}.',
      confirmPrompt: 'Type {word} below to confirm.',
      delete: 'Delete my account',
      deleting: 'Deleting…',
      cancel: 'Cancel and sign out',
      doneTitle: 'Your account has been deleted',
      doneBody: 'You have been signed out everywhere. Thank you for playing at Touch Padel.',
      errors: {
        credentials: 'That phone number or email and password do not match an account.',
        phone: 'Enter an Iraqi mobile number, for example 0770 123 4567.',
        email: 'Enter a valid email address.',
        staff: 'Staff accounts cannot be deleted here. Ask the venue owner to deactivate yours.',
        already: 'This account has already been deleted.',
        noAccount: 'There is no account to delete for this sign-in.',
        unavailable: 'Deleting on the website is not available right now. Use the app, or send us a request below.',
        generic: 'Something went wrong. Try again, or send us a request below.',
      },
    },
    social: {
      title: 'Signed up with Apple or Google?',
      body: 'Accounts created with Apple or Google have no password, so delete them in the app. If you no longer have the app, send us a request as described below.',
    },
    request: {
      title: 'Cannot sign in?',
      body: 'Email {email}, or call the front desk, with the phone number of your account and the words “Delete my account”. We confirm the account is yours and delete it within 30 days, usually much sooner.',
      emailSubject: 'Delete my Touch Padel account',
      emailButton: 'Email a deletion request',
    },
  },
} as const;
