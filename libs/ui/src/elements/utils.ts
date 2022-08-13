import { EntryHash } from '@holochain/client';
import { EntryHashMap } from '@holochain-open-dev/utils';
import { Commit } from '@holochain-syn/core';

export function getLatestCommit(
  commits: EntryHashMap<Commit>
): [EntryHash, Commit] {
  const sortedCommits = commits
    .entries()
    .sort(([_, c1], [__, c2]) => c2.created_at - c1.created_at);
  return sortedCommits[0];
}
