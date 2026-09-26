/**
 * `ws.content.*`: marketing content for the owners' approval: the Content section on
 * /marketing and on marketing's /tasks. Owned by lane P
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in content.ar.ts.
 *
 * Statuses, decisions and channels are `work.content.*`. Captions, notes and
 * reasons are staff free text, shown as typed.
 */
export const contentEn = {
  title: 'Content for approval',
  leadOwner:
    'Posts marketing wants to publish. Approve one, or send it back with a reason; you never edit the text.',
  leadMarketing:
    'Send a post for the owner’s approval. When the owner asks for changes, open it and send the next version.',
  filterLabel: 'Show content',
  filter: {
    waiting: 'Waiting',
    waitingCount: 'Waiting ({count})',
    changes: 'Changes asked',
    // Marketing's count of posts the owner sent back: they wait on marketing.
    changesCount: 'Changes asked ({count})',
    approved: 'Approved',
    closed: 'Closed',
    all: 'All',
  },
  empty: {
    waiting: 'Nothing waiting for approval.',
    changes: 'No post is waiting for changes.',
    approved: 'No approved posts yet.',
    closed: 'No declined or withdrawn posts.',
    all: 'No posts sent yet.',
  },
  waitingBadge: '{count} waiting',
  newPost: 'New post',
  plannedFor: 'for {date}',
  byName: 'by {name}',
  versionN: 'version {n}',
  sentAt: 'Sent {time}',
  sheet: {
    version: 'Version {n}',
    sentBy: 'Sent by {name}, {time}',
    decided: {
      approve: 'Approved',
      changes: 'Changes asked',
      decline: 'Declined',
    },
    superseded: 'Replaced before a decision',
    decidedBy: '{name}, {time}',
    caption: 'Caption',
    images: 'Images ({count})',
    imageAlt: 'Image {n}',
    link: 'Link',
    copy: 'Copy link',
    copied: 'Link copied.',
    copyFailed: 'Could not copy. Select the link and copy it.',
    note: 'Note from marketing',
    earlier: 'Earlier versions ({count})',
    item: 'About {name}',
    campaign: 'Campaign: {name}',
    ownPost: 'You sent this post, so another owner decides it.',
    changesReason: 'What should change',
    declineReason: 'Why it is declined',
    reasonHint: '{name} reads this.',
    // Approval is final: the button names the version it freezes.
    approveVersion: 'Approve version {n}',
    changesConfirm: 'Ask for changes',
    declineConfirm: 'Decline post',
    done: {
      approve: 'Approved. {name} is told.',
      changes: 'Changes asked. {name} is told.',
      decline: 'Declined. {name} is told.',
    },
    revise: 'Revise',
    withdraw: 'Withdraw',
    withdrawBody:
      'The owner stops seeing this post, and it cannot come back. Send again starts a new post from it.',
    withdrawConfirm: 'Withdraw post',
    withdrawn: 'Post withdrawn.',
    keep: 'Keep it',
    sendAgain: 'Send again',
  },
  form: {
    newTitle: 'New post',
    reviseTitle: 'Version {n}',
    title: 'Title',
    channel: 'Channel',
    chooseChannel: 'Choose a channel',
    plannedFor: 'Planned for',
    plannedForHint: 'The day you plan to post it.',
    body: 'Caption',
    consentHint: 'Ask anyone recognisable in a photo before it is posted.',
    link: 'Video or design link',
    linkHint:
      'A link that starts with {scheme}. The owner sees it as text; it is never opened here.',
    note: 'Note to the owner',
    noteHint: 'About this version only.',
    // A new post only, as on the phone (staff.content.form.about).
    about: 'Also about',
    abouts: {
      none: 'Nothing else',
      item: 'A menu item',
      campaign: 'A campaign',
    },
    chooseItem: 'Choose a menu item',
    chooseCampaign: 'Choose a campaign',
    submit: 'Send for approval',
    reviseSubmit: 'Send this version',
    sent: 'Sent for the owner’s approval.',
    revised: 'New version sent for approval.',
    issue: {
      required: 'Fill this in.',
      tooLong: 'Keep it to {limit} characters.',
      past: 'Pick today or a later day.',
      link: 'Use a full link that starts with {scheme}.',
      tooMany: 'Up to {limit} images.',
    },
    refused: {
      title: 'Write a title, in up to 120 characters.',
      channel: 'Choose a channel from the list.',
      plannedFor: 'Pick today or a later day.',
      body: 'Write the caption, in up to 4,000 characters.',
      images: 'An image did not upload properly. Remove it and add it again.',
      link: 'Use a full link that starts with {scheme}.',
      note: 'Keep the note to 1,000 characters.',
      about: 'That item or campaign is gone. Choose another, or pick “Nothing else”.',
    },
  },
  // Observe home and /ops (the owner).
  waiting: {
    title: 'Posts to approve',
    hint: 'Marketing sent content for your approval.',
    action: 'Review posts',
  },
} as const;
