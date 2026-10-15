
# notebooks

## Environment Setup

1. Install the holochain dev environment (only nix-shell is required): https://developer.holochain.org/docs/install/
2. Enable Holochain cachix with:

```bash
nix-env -iA cachix -f https://cachix.org/api/v1/install
cachix use holochain-ci
```

3. Clone this repo and `cd` inside of it.
4. Enter the nix shell by running this in the root folder of the repository: 

```bash
nix-shell
npm install
```

This will install all the needed dependencies in your local environment, including `holochain`, `hc` and `npm`.

## Building the DNA

- Build the DNA (assumes you are still in the nix shell for correct rust/cargo versions from step above):

```bash
npm run build:happ
```

## Running the DNA tests

```bash
npm run test
```

## UI

To test out the UI:

``` bash
npm start
```

To run another agent, open another terminal, and execute again:

```bash
npm start
```

Each new agent that you create this way will get assigned its own port and get connected to the other agents.

## Comments

Notes support Google-Docs-style comments in both editors. Select some text and
press the **+ Comment** button that appears beside the selection; the comment
opens as a card in a margin to the right of the text. Cards can be replied to,
resolved and reopened (the **Resolved** switch in the margin header shows
resolved ones), and deleted by their author.

How it works:

- The note's text is an Automerge `Text` (`body`) in the Syn document, and each
  comment's range is an Automerge mark named `comment:<id>` on it. Marks move
  with concurrent edits, overlapping comments from different people coexist,
  and a comment whose text is deleted stays in the margin as "original text was
  deleted" with its quote.
- Comment records (`comments[id]`: author, time, text, quote, resolved,
  replies) live beside the text in the same document, so they sync in real
  time and are versioned with the note. There is no DNA change.
- The markdown stays pure: comments are never written into the text. The JSON
  export carries them (`workspaces[].comments`), and the margin's copy button
  puts the markdown on the clipboard with comments as
  [CriticMarkup](http://criticmarkup.com/) (`{==text==}{>>@author: comment<<}`).
- Notes created before this feature stored the text as a list of characters;
  they are migrated to a `Text` the first time someone opens them.

Code: `ui/src/comments/` (pure modules and the shared controller),
`ui/src/elements/comment-margin.ts`, and the two editors. Unit tests run with
`npm run test:ui`; `tests/comments-e2e.mjs` drives two real agents through the
whole flow (see `tests/README.md`).

## Package

To package the web happ:

``` bash
npm run package
```

You'll have the `notebooks.webhapp` in `workdir`. This is what you should distribute so that the Holochain Launcher can install it.

You will also have its subcomponent `notebooks.happ` in the same folder`.

## Documentation

We are using this tooling:

- [NPM Workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces/): npm v7's built-in monorepo capabilities.
- [hc](https://github.com/holochain/holochain/tree/develop/crates/hc): Holochain CLI to easily manage Holochain development instances.
- [@holochain/tryorama](https://www.npmjs.com/package/@holochain/tryorama): test framework.
- [@holochain/client](https://www.npmjs.com/package/@holochain/client): client library to connect to Holochain from the UI.
