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
 * window read live from venue_settings_public, so the terms never contradict the app. It
 * arrives as a whole counted phrase ("4 hours", «12 ساعة»: apps/web/src/lib/site/plural.ts),
 * never a bare number, because Arabic picks the noun's form by the count.
 * Values still reading `[FILL: …]` are for the partner to complete — see
 * docs/legal/LEGAL-DETAILS-TO-FILL.md and scripts/check-legal-placeholders.mjs.
 * The venue phone and hours come from venue_settings_public, never from here.
 *
 * 29 September 2026 (docs/design/open-matches/guest.md §4.25, DF-17, DF-20, OM-41, R14, R36):
 * online payment by Qi Card for court deposits and open-match tickets, open matches and their
 * tickets, what other players see ("First L.", preset messages, the organiser's games and
 * no-show counts), the gender asked once for women-only and men-only matches, reports and
 * blocks, the conduct clause, and what deleting an account does to matches and tickets. One
 * terms-version bump covers the deposit wording and open matches. The Arabic was written in
 * the same change and is for the client's lawyer (DRAFT-AR); the Arabic version governs.
 */
export const legalEn = {
  lastUpdated: 'Last updated: 29 September 2026',
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
      matchesLead: 'Open matches.',
      matches:
        'The matches you start, join or ask to join; your seats and whether you came; the open-match tickets you buy, use, lose or get refunded; the preset messages you send; the reports you make and the players you block; and, once, whether you are a woman or a man, which decides whether women-only or men-only matches are offered to you. The front desk can correct it.',
      cafeLead: 'Café orders from your table.',
      cafe:
        'When you scan a table’s QR code, your browser gets an anonymous session with no name or phone number. We record the table, what you order, any note you add to an item, and when. If you are signed in to an account, your orders can be linked to it.',
      pushLead: 'Notification token.',
      push: 'If you allow notifications, your device gives the app a push token. We store it to send you booking confirmations, reminders, cancellations and no-show notices, open-match updates and reminders, and other players’ preset messages.',
      providersLead: 'Sign in with Apple or Google (optional).',
      providers:
        'If you choose one of these, we receive your name, your email address and an account ID from that provider. Apple may give us a private relay address instead of your real email. We never receive your Apple or Google password.',
      notesLead: 'Notes the venue keeps.',
      notes:
        'Staff can add short notes and labels to your customer record — for example a birthday, a preference or a payment note — so they can serve you well. Only staff can see them. If an incident happens at the venue, staff may record what happened and who was involved. The record is kept for up to a year, only the staff member who wrote it and the venue’s managers and owner can read it, and it is never sent to the AI assistant.',
      consentLead: 'Your agreement.',
      consent: 'The version of our Terms of Service and this policy you accepted, and when.',
      technicalLead: 'Security and audit records.',
      technical:
        'Our systems record sign-ins, errors and every change staff make to bookings, orders and payments, with the time and the account or device that made it.',
      notCollected:
        'The app does not collect your location or contacts, and a guest account cannot upload photos: only venue staff accounts can attach work photos, in the app’s staff area. The app has no advertising, no tracking and no third-party analytics or crash reporting. Online payments (court deposits and open-match tickets) are made on Qi Card’s own payment page; we never see or store your card details.',
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
      matches:
        'running open matches: showing a match to the players who can join it, seating players, holding and returning tickets, and telling players about their match — to perform our agreement with you;',
      notify:
        'sending booking confirmations, reminders and changes as notifications — with your consent, which you can withdraw at any time in your device settings;',
      rules:
        'applying the venue’s rules, such as the cancellation window and limits after repeated no-shows, handling reports and blocks between players, limiting access to open matches, and preventing fraud and abuse — our legitimate interest in keeping courts available and fair;',
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
      players:
        'Other players. When you are in an open match or ask to join one, the players who can see that match see your first name, the first letter of your surname and your preset messages. When you ask to join, the organiser also sees how many games you have played at Touch and how many you missed. Players never see your phone number, email address or full surname. A public match’s time, branch, category and free seats are shown to other guests; a match link shows the same, with no names, to anyone who has it.',
      processorsLead: 'Service providers that run parts of the service for us, only on our instructions and only with what they need:',
      supabase: 'Supabase — database, sign-in and server hosting (Frankfurt, Germany);',
      push: 'Expo, Apple Push Notification service and Firebase Cloud Messaging — delivering notifications to your device;',
      signIn: 'Apple and Google — only if you choose to sign in with them;',
      qi: 'Qi Card — taking online payments and refunds for court deposits and open-match tickets;',
      whatsapp:
        'OTPIQ and Meta (WhatsApp), with Twilio as a possible backup — delivering verification codes by WhatsApp or SMS;',
      telegram:
        'Telegram — café orders (the table, the items and any notes, never your name or phone number) are sent to the venue staff’s private Telegram group so the kitchen and waiters can prepare them;',
      ai: 'an AI service provider (currently Groq; the venue may switch to Anthropic) — the venue owner can ask an assistant questions about bookings and sales. The records needed for an answer are sent to the provider; phone numbers and email addresses are replaced with placeholders first, but names can be included. When the owner asks about open matches, players’ names and the gender a player gave can be included;',
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
        'When you delete your account, your login, your first name, surname and gender, your phone number, email address and linked Apple or Google sign-in are removed immediately, and you are signed out on every device. Your notification token, staff notes about you, the list of players you blocked and any notifications waiting to be sent are deleted too.',
      bookings:
        'Bookings and café orders you have already made stay in the venue’s records with no name, phone number or notes attached, because the venue has to keep its own accounts. They can no longer be linked to you. The record that you accepted our terms stays with them, without your name.',
      matches:
        'Open matches you took part in stay in the venue’s records without your name, as bookings do. Tickets, their purchases and refunds stay in the venue’s accounts without your name; tickets you had not used are refunded to the card you paid with. Reports between players are kept for 12 months and then deleted.',
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
      'The agreement for using the Touch Padel app and website, booking courts, playing open matches and ordering at the venue: bookings, open matches and tickets, cancellations, venue rules, safety and liability.',
    intro:
      'These terms are the agreement between you and {company} for using the Touch Padel app and this website, booking courts, playing open matches, and ordering at the {tradingName} venue. By creating an account, or by booking, joining a match or ordering, you agree to them. Please read them.',
    who: {
      title: 'Who we are',
      body: '{tradingName} is operated by {company}, commercial registration number {registration}, of {address}. You can reach us at {email} or at the front desk.',
    },
    accounts: {
      title: 'Your account',
      age: 'You must be at least 13 to create an account. If you are under 18, you confirm that a parent or guardian has agreed to these terms for you.',
      accurate:
        'Give your real name and a phone number that is yours, and keep them up to date. One account per person. In open matches, other players see your first name and the first letter of your surname.',
      secure:
        'Keep your password to yourself. Bookings made from your account are your responsibility unless you tell us it has been misused.',
      desk: 'If the front desk created an account for you, these terms apply from the first time you sign in and accept them.',
    },
    bookings: {
      title: 'Bookings',
      confirm:
        'A booking is made when the app or the front desk shows it as confirmed. A time you hold but do not confirm in time is released for others.',
      price:
        'Prices are shown in Iraqi dinars (IQD) before you confirm. Unless the app says otherwise, you pay at the venue. Some bookings ask for a deposit paid online by Qi Card, and open-match tickets are bought online by Qi Card.',
      cancel:
        'You can cancel for free in the app until {cancelHours} before your slot. Less than {cancelHours} before, only the front desk can change or cancel it.',
      noShow:
        'If you do not come and have not cancelled, the booking may be marked as a no-show. Repeated no-shows may lead us to limit or suspend booking from your account.',
      time: 'Please arrive on time. A slot ends at its scheduled time even if play starts late.',
      venueCancel:
        'We may have to cancel or move a booking — for example for maintenance, safety, a power cut or an event. We will tell you as early as we can and offer you another time or cancel it at no charge.',
    },
    openMatches: {
      title: 'Open matches',
      startLead: 'Starting and joining.',
      start:
        'You can start an open match at a free time, or join one. The court is booked for the match when the fourth player is in. Until then no court is held for it, and if a group books the last free court at that time, the match is cancelled.',
      ticketsLead: 'Tickets.',
      tickets:
        'Every seat in a match needs an open-match ticket, bought online by Qi Card. Seats you take for friends use your tickets. A ticket can be used again and never expires. It is held while you are in a match or waiting for an organiser’s answer, and comes back after you play or when a match is cancelled. It is lost if you do not come, or if you leave a booked match and nobody takes your seat before it starts.',
      refundLead: 'Money back.',
      refund:
        'Only tickets you have not used can be refunded, on request at the front desk. A manager refunds them to the card you paid with, once none of that purchase’s tickets is in a match, as one refund per purchase.',
      shareLead: 'Your share.',
      share:
        'Every player who comes pays their share of the court at the front desk. A ticket is not a share of the court.',
      venueLead: 'The venue.',
      venue: 'We may cancel or move a match. When we cancel one, its tickets come back.',
      genderLead: 'Women-only and men-only matches.',
      gender:
        'Tell us honestly whether you are a woman or a man, and declare the friends you bring honestly. The front desk may check.',
      conductLead: 'Conduct.',
      conduct:
        'The organiser may remove a player before the court is booked. The venue may remove a player from a match, or stop an account from using open matches. If the venue removes you from a match after the court is booked, for example for conduct or because you asked, your ticket is lost unless another player takes your seat before it starts. If we removed you by mistake, your ticket comes back.',
      deleteLead: 'Deleting your account.',
      delete: 'If you delete your account, you leave your matches, and your unused tickets are refunded to the card you paid with.',
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
      use: 'Use the app only for your own bookings and orders. Do not make bookings you do not intend to keep, interfere with the service, try to reach other people’s information, or copy or scrape it. Be respectful to other players. Don’t use a name that is offensive or pretends to be someone else, and don’t misuse reports. We may remove you from a match, or stop your account from using open matches, for this.',
      availability:
        'We work to keep the app available and correct, but it may sometimes be unavailable or wrong. If the app and the front desk disagree about a booking, we will settle it with you fairly using the venue’s records.',
      ip: 'The app, the website, and the Touch Padel name and logos belong to us or our licensors. You may use them only to use the service.',
    },
    messages: {
      title: 'Messages from us',
      body: 'We send verification codes and, if you allow notifications, messages about your bookings, updates about your open matches and other players’ preset messages. Any promotional messages are sent only as the law allows, and you can turn notifications off at any time.',
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
      body: 'You can delete your account at any time, in the app or on our website. We may suspend or close an account, or stop it from using open matches, if it breaks these terms, is used for fraud, or repeatedly does not show up for bookings. We will tell you why unless the law or safety prevents it.',
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
      pay: 'You pay at the front desk when you arrive. Only a court deposit, when a booking asks for one, and open-match tickets are paid online, by Qi Card.',
      notify: 'If you allow notifications, you get a confirmation when you book and a reminder before your slot.',
    },
    cancel: {
      title: 'Cancelling',
      free: 'You can cancel for free in the app until {cancelHours} before your slot.',
      late: 'Less than {cancelHours} before, contact the front desk to change or cancel.',
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
        'Deleted immediately: your login, your first name, surname and gender, phone number, email address, linked Apple or Google sign-in, notification token, the players you blocked, the staff notes about you and any notifications waiting to be sent. You are signed out on every device.',
      kept: 'Kept, without your name: bookings and café orders you have already made, open matches you played in, and reports between players (for 12 months), because the venue has to keep its own accounts. They can no longer be linked to you.',
      tickets: 'Open-match tickets you have not used are refunded to the card you paid with.',
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
