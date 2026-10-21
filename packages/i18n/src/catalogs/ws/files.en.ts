/**
 * `ws.files.*`: the Files page (/files, 0354), the documents the owner and
 * the managers keep in the system. Every file is compressed before it is
 * stored, and the owner's assistant reads the words in it.
 * Mirror every key in files.ar.ts.
 *
 * Single-line literals only (the assistant map indexes them).
 */
export const filesEn = {
  title: 'Files',
  lead: 'Contracts, licences, price lists and reports, kept in one place. Every file is packed smaller before it is saved, and the assistant can read what it says.',
  add: {
    title: 'Add files',
    drop: 'Drop files here, or press to choose',
    hint: 'Up to 50 MB each. PDFs, Word, Excel, PowerPoint, text and photos. Photos are saved as WebP; every other file is zipped and comes back exactly as it was.',
    pick: 'Choose files',
    ownerOnly: 'Only me',
    ownerOnlyHint: 'Managers will not see these files.',
    stage: {
      compressing: 'Packing…',
      uploading: 'Sending…',
      saving: 'Saving…',
    },
    done: 'Saved as {size}, {saved}% smaller. The assistant sees its name only.',
    doneReadable: 'Saved as {size}, {saved}% smaller. The assistant can read it.',
    problem: {
      empty: 'This file is empty.',
      tooLarge: 'This file is over 50 MB. Split it or save a smaller copy.',
      quota: 'There is no room left for this file. Remove files you no longer need.',
    },
  },
  list: {
    title: 'Saved files',
    search: 'Find by name or note',
    emptyTitle: 'No files yet',
    emptyBody: 'Drop a contract, a licence or a price list above. It is saved here for every manager and the owner, and the assistant can answer questions about it.',
  },
  usage: '{used} of {total} used',
  size: {
    B: '{n} B',
    KB: '{n} KB',
    MB: '{n} MB',
    GB: '{n} GB',
  },
  col: {
    name: 'File',
    added: 'Added',
    size: 'Size',
    assistant: 'Assistant',
    actions: 'Actions',
  },
  ownerOnly: 'Only the owner',
  stored: 'stored {size}, {saved}% smaller',
  storedSame: 'stored {size}',
  readable: 'Can read it',
  readableHint: 'The assistant can read the words in this file when Saved files is ticked in a chat.',
  nameOnly: 'Name only',
  nameOnlyHint: 'No words could be read from this file (a photo or a scanned page). The assistant sees its name and note.',
  download: 'Download',
  edit: 'Edit',
  remove: 'Remove',
  removeTitle: 'Remove {name}?',
  removeBody: 'The file is deleted for everyone and the assistant can no longer read it. This cannot be undone.',
  removed: '{name} removed',
  notYours: 'Only the owner or the person who added this file can remove it.',
  field: {
    name: 'Name',
    note: 'Note',
    noteHint: 'What the file is. The assistant reads this too.',
  },
  save: 'Save',
  cancel: 'Cancel',
  saved: 'File updated',
} as const;
