// Canonical human labels for plan actions — used by both the executor (undo-log
// labels) and the panel UI, so they can't drift ("Bookmark" vs "Bookmark tab").
export const ACTION_LABELS = {
  closeTab: 'Close tab',
  groupTabs: 'Group tabs',
  parkTab: 'File into parked group',
  createBookmark: 'Bookmark tab',
  deleteBookmark: 'Delete bookmark',
  discardTab: 'Suspend tab',
  moveBookmark: 'Move bookmark',
  removeFolder: 'Remove empty folder',
};

// Human labels for the bookmark-cleanup status buckets (see viewmodel.statusBucket).
export const STATUS_LABELS = {
  'http-404': 'Not found (404)',
  'http-410': 'Gone (410)',
  unreachable: 'Unreachable',
  'dead-other': 'Dead link',
  duplicate: 'Duplicate',
  stale: 'Not visited recently',
  other: 'Other',
};
