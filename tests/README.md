# tests

## `typing-perf.mjs` — multi-agent typing soak / performance test

Exercises the real stack, not a simulation of it: **one conductor per agent** on
a shared local network, **one vite dev server per agent** (the conductor ports
are compiled into the bundle, so agents cannot share a server), **one headless
Chrome tab per agent**, and **genuine key events** dispatched into CodeMirror.
Every keystroke goes through the editor, the text-editor grammar, the syn
session, Automerge and the DHT exactly as it does for a human.

```bash
nix develop --command node tests/typing-perf.mjs
```

The happ must be built first (`npm run build:happ`).

### Scenario

1. Agent A opens a new note and types about half a page.
2. Agent B puts the caret at the top of the document and types a few pages
   there **while A keeps typing where it left off** — genuinely concurrent
   editing at two different positions in one document.
3. Agent C sits in the session as a reader and has to converge too.

### What it asserts

- all three agents end on byte-identical text
- no keystrokes were lost (final length ≈ starting length + keystrokes typed)
- the session did not commit-storm: commits stay inside a budget derived from
  notebooks' `SYN_CONFIG` (a commit per 200 deltas or per 30s, per typing agent)
- no uncaught exceptions or `console.error` in any tab

### Knobs

| env | default | meaning |
| --- | --- | --- |
| `CPS` | `8` | characters per second per agent (human pace) |
| `A_FIRST` | `600` | chars A types first (~half a page) |
| `B_CHARS` | `2500` | chars B types at the top (~2-3 pages) |
| `A_CONT` | `600` | chars A types while B is typing |
| `SYNC_FAIL_PCT` | `2` | share of live-sync messages allowed to time out |
| `HEADFUL` | unset | show the browser windows |
| `KEEP` | unset | leave conductors/servers up for poking at afterwards |

A default run takes about 9 minutes, most of it the 387s of actual typing.

### Measured behaviour

Two runs on this repo, same 3700 keystrokes across 3 agents, differing only in
typing speed:

| | `CPS=8` (human) | `CPS=25` (~3x human) |
| --- | --- | --- |
| converged | yes, **within 0.1s** of the last keystroke | yes, but **43-64s** after |
| final text | identical on all 3 agents | identical on all 3 agents |
| keystrokes lost | none | none |
| commits | 18-21 (~5 per 1k chars) | 1-4 (~1 per 1k chars) |
| live sync (`send_message`) | thousands sent, **0 timed out** | busiest agent **55-78% timed out** |

Counts vary run to run -- gossip and the 30s commit timer do not line up the
same way twice, and across repeated runs the same scenario produced 18 and 21
commits, and 3826 and 7237 sync messages. What is stable is the shape: at human
pace nothing times out and convergence is instant; at 3x human pace the busiest
agent's sync channel collapses while the document still converges correctly.

Read that as: **at human speed it works well** — live sync keeps up, so the
document is already converged the instant typing stops. Push to 3x human speed
and the busiest typist's sync channel collapses (78% of its `send_message` calls
hit the 60s timeout), yet the document still converges correctly, just via
commits and the DHT instead of live sync, and no keystrokes are lost. Degraded,
not broken.

The commit counts move in the opposite direction to what you might expect: syn
commits every 200 deltas *or* every 30s, and a human-paced run simply spends
longer in the session, so the timer fires more often. Neither run is anywhere
near a commit storm.

### What it asserts

Hard failures: agents did not converge, final text differs between agents,
keystrokes were lost, commits blew the budget, or a tab logged an unexpected
error. Live-sync timeouts are reported as their own percentage and fail the run
above `SYNC_FAIL_PCT`, because they do not corrupt the document -- they just
stop collaboration feeling real-time.
