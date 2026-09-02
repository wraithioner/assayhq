# Are there benchmarkable AI trading agents on Robinhood Chain?

**A measurement note. Robinhood Chain (Arbitrum Orbit L2, chain ID 4663).**
Measured 2 September 2026 at head block **52,527,642**. Chain launched 1 July 2026.

**Short answer: no — not today.**

Exactly **one** address on the chain satisfies the conditions required to benchmark a trading
agent honestly, and it has made **four** Stock Token movements in total. That is not a
population; it is a rounding error. Separately, there *is* a substantial automated population
trading Stock Tokens — roughly **51** addresses operating continuously — but it does not
register any identity, and its behaviour looks more like market-making and arbitrage than like
autonomous strategy agents. Both findings are below, with the method and the numbers.

**Scope correction.** This document measures *agents* and *Stock Token flow*. It is not a
measurement of the chain: Robinhood Chain earns $157.9M in protocol fees per 30 days and ranks
#4 in crypto, almost entirely from memecoin launchpads and DEX trading that this document never
looked at. See [`CHAIN_SCALE.md`](./CHAIN_SCALE.md).

**Read the venue caveat in §6 before quoting the headline number.** Robinhood's own agent
product had roughly 100,000 accounts by July 2026 — all of it inside the brokerage, none of it
onchain. The near-zero count here is a fact about *this venue*, not about how many trading
agents exist. Sources: [`AGENT_VENUE.md`](./AGENT_VENUE.md).

---

## 1. What "benchmarkable" has to mean

The published literature on LLM trading agents has a measurement problem rather than a
performance problem. In a survey of 77 studies, 19 met a minimum bar of producing actions in a
closed loop; of those, roughly one modelled transaction costs and one documented survivorship
handling, and none reached full reproducibility. The field cannot compare agents to each other
because the protocol to do so does not exist.

On-chain execution can supply that protocol for free, because four things become facts rather
than claims:

1. **Identity** — you know which address acted, and it cannot be swapped after the fact.
2. **Costs** — every fill has a real execution price and a real gas cost.
3. **Survivorship** — a dead agent is still in the data. It cannot be deleted from the sample.
4. **Point-in-time** — you can value a position using only information available at that block.

An address is *benchmarkable* only if all four hold. In practice that means: it declares an
identity, it trades assets with an independent price feed, and its trades happen on a venue
whose execution price you can read. Failing any one of those makes a published return number
unfalsifiable, which is worse than publishing nothing.

## 2. Method

Everything below is read-only, from chain state, via the public RPC (`eth_getLogs`,
`eth_getBlockByNumber`, `eth_call`) plus Blockscout for verified-contract metadata. No archive
node was required.

Two identifiers do the work:

- `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` — the ERC-8004
  identity registry, topic `0xca52e62c…`.
- `TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)`
  — every Stock Token movement, topic `0x37e7f0db…`. (Note: the deployed contracts use this
  name, not the EIP-8056 draft's `TransferWithUIAmount`, whose topic never appears on chain.)

**Full enumeration of Stock Token flow is not possible from this endpoint.** The RPC caps
responses at 10,000 logs, and a single 10,000-block window already exceeds that — implying
**more than 50 million** Stock Token movements since launch. Registry data is small enough to
enumerate exactly; flow data is therefore sampled: 16 windows of 400 blocks, spread across the
40M blocks below head, covering **0.0122%** of chain history.

Sampled discovery makes the address counts **lower bounds**. An address active in less than
roughly a fifth of all 40-second intervals can be missed entirely, so the error runs toward
undercounting the automated population, not overcounting it.

**The holder side of this was later measured exactly.** Current balances do not require log
replay — the explorer's holder index is already net of every movement — so all 193 indexed
tokens were enumerated in full: **919,694 positions, 237,903 distinct addresses, nothing
sampled**. That census, and what it says about position sizes, is in
[`HOLDER_BASE.md`](./HOLDER_BASE.md). It does not change any flow number in this document,
which remains sampled.

## 3. The registered population: 61 identities, 1 benchmarkable

The ERC-8004 `IdentityRegistry` is live at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
(ERC-1967 proxy, deployed at block 12,058,809, implementation `IdentityRegistryUpgradeable`,
an ERC-721 named "AgentIdentity"). It is not mentioned anywhere in Robinhood's developer
documentation; it was found by probing the standard ERC-8004 addresses and confirmed on chain.

Every registration ever emitted, enumerated exactly:

| Gate | Surviving | Note |
|---|---|---|
| Registrations | **61** | agentIds 0–60 |
| Unique owner addresses | **45** | 4 owners hold >1 identity; one holds 11 |
| …with any Stock Token movement after their own registration block | **3** | 42 of 45 have never moved a Stock Token |
| …trading majority in tokens that have a price feed | **3** | all three are 100% feed-covered |
| …whose trades can be matched to a priced execution | **1** | 2 of 3 excluded |
| **Benchmarkable** | **1** | and it has 4 movements, 3 of them priced |

Three details matter for interpreting that funnel.

**Registration is close to costless and partly automated.** 61 identities across 45 owners,
with one owner holding 11 and ids 38–53 landing within about 100 blocks of each other — the
signature of scripted batch registration, not 61 independent operators.

**The two exclusions are real, not artefacts of a strict filter.** The largest of the three
active registrants moved Stock Tokens 36 times but only 5 of those movements sit in a
transaction containing a decentralised-exchange trade. A representative excluded transaction
contains exactly two logs — a `Transfer` and a `TransferWithScaledUI` — and no swap, no
quote-asset leg, and no venue interaction at all. It is a one-way token send into a contract.
There is no execution price, so there is nothing to measure. Those sends go to five
minimal-proxy clones of a verified `RHBTCAccount` contract, which delegate to a protocol called
`RHMachines`: the address is making deposits, not trades.

**Price-feed coverage is not the binding constraint.** Only 35 of the 194 Stock Tokens have a
Chainlink feed, which sounds like a serious limit — but all three active registrants trade
exclusively inside those 35. Coverage excluded nobody here.

## 4. The unregistered population: ~51 sustained automated addresses

If registered agents are almost absent, the obvious question is whether an equivalent
population exists that simply never registered. Public reporting claimed roughly 2,100 agents
deployed in the chain's first week.

Sampling the flow gives a clear answer: automated Stock Token trading is large.

| Measure | Value |
|---|---|
| Stock Token movements | **13.26 / block ≈ 11.46M / day** |
| Chain-wide transactions | 15.55 / block ≈ 13.44M / day |
| Distinct addresses touching Stock Tokens in 0.0122% of blocks | **1,694** |

Counting addresses that recur across independent sampled windows, after excluding venue
infrastructure (any contract answering `token0()`, i.e. an AMM pool — 19 of them):

| Present in ≥ k of 16 windows | Addresses |
|---|---|
| ≥ 3 | **51** |
| ≥ 5 | 33 |
| ≥ 8 | 17 |
| ≥ 10 | 12 |
| ≥ 12 | 8 |

Each window is 400 blocks ≈ 40 seconds. Appearing in three separate 40-second snapshots
scattered across 60 days implies activity in a large fraction of all such intervals, so k=3 is
a sparse-sampling bar rather than a lax one.

For context, the literal threshold "more than 50 Stock Token movements since launch" does not
discriminate at this density. With 1,694 addresses visible in 0.0122% of blocks, the
extrapolation factor is ~8,207×, so a single sampled movement already implies thousands since
launch. The qualifying population is in the thousands; recurrence is the meaningful cut.

## 5. The cadence finding: automated, but not scheduled

Profiling the 51 non-venue sustained addresses gives two signals that point in opposite
directions, and the second is the interesting one.

| Signal | Result |
|---|---|
| Active outside US market hours (incl. weekends), in ≥3 windows | **50 / 50** |
| Inter-event timing measurable (≥5 gaps) | 38 |
| **Median inter-event gap coefficient of variation** | **2.14** |
| Highly regular timing (CV < 1.0) | **2 / 38** |
| Contracts / EOAs | 41 / 9 |

Every one of them trades round-the-clock, which rules out humans. But the timing is **bursty,
not metronomic**: a CV above 2 means activity arrives in clusters, and only 2 of 38 addresses
resemble a scheduled job. One address produced 3,027 Stock Token movements inside a single
500-block (~50 second) window.

Bytecode tells the same story. Excluding the 19 AMM pools, the sustained set is **51 distinct
singleton bytecodes**, with only small clone fleets (4 addresses sharing a 130-byte
proxy, 3 sharing an EIP-1167 45-byte proxy, 2 sharing a 23-byte stub). There is no large fleet
of identical agents deployed from one framework.

Reactive burst timing, continuous operation, inventory-scale message rates, and heterogeneous
one-off bytecode together describe **market-making and arbitrage infrastructure**. They do not
describe a population of strategy agents making periodic allocation decisions. Bytecode cannot
prove intent, and this evidence does not settle what these addresses *are* — but it does not
support calling them AI trading agents.

## 6. Conclusion

- **Benchmarkable AI trading agents on Robinhood Chain today: effectively zero.** One address
  clears every gate, with four Stock Token movements. Four movements cannot support a Sharpe
  ratio, an information ratio, or a drawdown series. Any leaderboard built on this would be
  publishing noise.
- **ERC-8004 is not a useful discovery mechanism here.** 61 registrations, 45 owners, 3 that
  trade, 1 measurable — while roughly 51 sustained automated traders never registered at all.
  Registration and activity are close to uncorrelated on this chain.
- **Automated Stock Token trading is real and large** — ~11.5M movements per day, nearly one
  per chain transaction by event count — but its observable behaviour is that of market makers
  and arbitrageurs, not of autonomous agents. Whether an LLM-agent subset exists inside it is
  unresolved, and its size could be zero.
- **The claim of ~2,100 agents is not visible in Stock Token flow.** Whatever those agents
  were, they are not identifiable as a sustained, distinguishable population trading tokenized
  equities.
- **The infrastructure was not the constraint.** Feed coverage excluded nobody, and the
  ERC-8056 corporate-action mechanics that were expected to be dangerous turned out to be
  nearly free (a 1% dividend costs a constant-product pool ~0.124 bps; a compensated split
  costs zero). The constraint is that the population being measured does not yet exist.

### Caveat: the agents are somewhere else, and this venue never had them

Verified against Robinhood's newsroom, support docs, chain developer docs and SEC filings on
2 September 2026 — full sourcing in [`AGENT_VENUE.md`](./AGENT_VENUE.md):

- **Robinhood's agent product shipped, and it is large.** Agentic Trading launched 27 May 2026
  and covers equities, options and crypto. The Q2 2026 Form 8-K (29 July 2026) reports "nearly
  100 thousand customers have opened Agentic Trading accounts, with over $100 million in AUC."
- **All of it executes in the brokerage, not on any chain.** Agents connect through the
  Robinhood Trading MCP (`agent.robinhood.com/mcp/trading`) to custodial broker-dealer
  accounts. Of the 57 documented tools, none transfers, bridges, stakes, lends or withdraws;
  Robinhood's support docs state plainly that an agent "can't transfer, stake, or lend."
  Without a transfer there is no path to chain 4663.
- **Onchain agentic accounts have not shipped and were never announced.** No page in the
  Robinhood Chain developer documentation mentions agentic trading, MCP, or ERC-8004.
- **The two populations are legally disjoint.** Agentic Trading is offered "to U.S. customers"
  (Form 10-Q, 30 July 2026). Stock Tokens are Regulation S instruments that "may not be
  offered, sold or delivered within the United States to, or for the account or benefit of
  U.S. Persons." The accounts that have an agent cannot hold the asset scored here.

So the honest reading of the "one benchmarkable address" number is narrower than it first
looks, in both directions. It is **not** evidence that autonomous trading agents are rare —
they are numerous and well funded, just behind a custodial API that emits no logs. And chain
4663 is **not** a closed venue: it is permissionless and has been open since 1 July 2026.
What is missing is any product routing agents onto it. That gap is a securities-registration
problem, not an indexing one, and no amount of better measurement closes it.

**One open variable.** Every number here was produced while Robinhood covered gas. The 90-day
fee waiver ends around 29 September 2026, and no measurement of this chain unsubsidised exists
yet. The next section makes that comparison a single command.

## 7. Reproducing this

A snapshot script takes the same measurements deterministically and diffs two runs:

```bash
# baseline already committed: docs/data/snapshots/2026-09-02-pre-subsidy-end.json
python3 scripts/snapshot/subsidy_snapshot.py --out docs/data/snapshots/2026-09-30-post-subsidy-end.json

python3 scripts/snapshot/subsidy_snapshot.py --diff \
  docs/data/snapshots/2026-09-02-pre-subsidy-end.json \
  docs/data/snapshots/2026-09-30-post-subsidy-end.json
```

It reports Stock Token movement rate, chain-wide transaction rate, and the sustained
agent-like address count, all relative to the head block at run time. Sampling constants are
fixed in the script; changing them between runs invalidates the comparison.

The registry funnel in §3 can be re-derived directly:

```bash
# every ERC-8004 registration ever, in one call
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
        "fromBlock":"0x0","toBlock":"latest",
        "address":"0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        "topics":["0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a"]}]}'
```

Per-owner Stock Token activity uses the same `eth_getLogs` call with topic
`0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802` and the owner address in
`topics[1]` (sent) or `topics[2]` (received). A movement counts as priced only if its
transaction receipt also contains a Uniswap V3 `Swap` log
(`0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`).

Raw intermediates for the registry funnel are in
[`docs/data/backfill/`](./data/backfill); the full registry diagnostic is in
[`BACKFILL.md`](./BACKFILL.md).

**Scope note.** This document is a count. Nothing measured here enters any scoring universe,
no address is profiled or ranked, and the rule that scoring begins at an agent's registration
block — never backfilled — is unchanged.
