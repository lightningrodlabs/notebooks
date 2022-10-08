import { Create, EntryHash } from '@holochain/client';
import { RecordBag } from '@holochain-open-dev/utils';
import { Commit } from '@holochain-syn/core';

export function getLatestCommit(
  commits: RecordBag<Commit>
): [EntryHash, Commit] {
  const sortedActions = commits.actionMap
    .values()
    .sort((a1, a2) => a2.timestamp - a1.timestamp);
  const entryHash = (sortedActions[0] as Create).entry_hash;
  const commit = commits.entryMap.get(entryHash);
  return [entryHash, commit];
}
