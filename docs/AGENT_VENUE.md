# Where do Robinhood's trading agents actually execute?

**A source-verification note.** Checked 2 September 2026 against Robinhood's newsroom,
support documentation, Robinhood Chain developer docs, and SEC filings. Every claim below
is quoted from a primary source and dated; secondary press coverage was used only to locate
documents, never as evidence.

**Short answer: they execute inside the brokerage, and only inside the brokerage.**
Agentic Trading shipped in May 2026 and now covers equities, options and crypto — roughly
**100,000 accounts and over $100M in customer assets** by 29 July 2026. All of it runs
through the Robinhood Trading MCP against custodial broker-dealer accounts. **No Robinhood
product lets an agent transact on Robinhood Chain (chain 4663)**, nothing in the chain's
developer documentation mentions agents, and the shipped agent is explicitly barred from
the transfer that reaching the chain would require.

---

## 1. Did Robinhood ship a trading MCP for brokerage execution?

**Yes — 27 May 2026, to US Robinhood brokerage customers.**

The newsroom post *Robinhood is Now Open to Agents* (27 May 2026) announced Agentic Trading
and the Agentic Credit Card together:

> "Bring your agents from anywhere and simply connect them to Robinhood's AI-native Model
> Context Protocol (MCP) servers for fast, seamless integration into the Robinhood experience."

Two MCP servers were announced: a **Trading MCP** and a **Banking MCP** (the latter for the
Agentic Credit Card). The Trading MCP endpoint is published in Robinhood's support docs:

```
https://agent.robinhood.com/mcp/trading
```

Robinhood documents connection instructions for Claude Code, Claude Desktop, ChatGPT, Codex,
Codex CLI, Cursor and Grok, plus "other AI platforms that support MCP connections."

**Who it is for.** An "Agentic account" is a separate, self-directed individual investing
account; customers may hold up to 10 self-directed individual accounts including it, must
already have a primary account in good standing, and can only complete onboarding on a
desktop device. Brokerage services are Robinhood Financial LLC, clearing is Robinhood
Securities LLC, crypto is Robinhood Crypto LLC. The Q2 2026 Form 10-Q states the feature is
one "**which we currently offer to U.S. customers**."

**What the agent can reach.** The support article *Trading with your agent* documents the
complete tool surface — **57 tools in seven categories**: account/portfolio (5), watchlists
(12), market data (9), equities (8), options (10), crypto (7), scanners (6). Order placement
is `place_equity_order`, `place_option_order`, `place_crypto_order`.

## 2. When did agentic trading launch for equities and options?

| Asset class | Status | Primary source |
|---|---|---|
| **Equities** | **27 May 2026**, beta | Newsroom, 27 May 2026: "launching in beta with support for equities only out of the gate" |
| **Options** | **Between 27 May and 1 July 2026** | Newsroom, 1 Jul 2026: "After launching Agentic Trading for equities **and options** in the US last month" |
| **Crypto** | **Between 1 and 29 July 2026** | Form 8-K Ex. 99.1, 29 Jul 2026 (see §3) |

The 27 May post listed what was still to come: "Support for options, crypto, event contracts,
futures, and more are coming soon as we move out of beta."

**Options has no separate announcement.** No newsroom post covers the options launch; the date
is bounded only by Robinhood's own retrospective statement on 1 July. Treat "June 2026" as an
inference from that bound, not a published date. Event contracts and futures remain unshipped
as far as any primary source shows.

Current state, from the support docs: "**You currently can use your agent to place long
equities, options, and crypto orders.**" Margin borrowing is *not* enabled for Agentic
accounts; limited margin (unsettled funds only) is.

## 3. Have "agentic accounts" for digital assets shipped?

**For custodial crypto: yes, and at scale. For anything onchain: no — and it was never
announced.** These are two different questions and the press coverage conflates them.

**The announcement (1 July 2026) was forward-looking.** The Robinhood Chain mainnet post said:

> "we are **preparing to launch** Agentic Accounts for crypto. Using our Trading MCP, eligible
> US traders can connect their AI model of choice to Robinhood data sources and tools. …
> Agentic Trading for Crypto **will begin rolling out soon** to eligible US traders."

That post's own forward-looking-statements section lists "Agentic Accounts for crypto trading"
among items not yet delivered. The page was last updated 30 July 2026 and still reads
"preparing to launch."

**It shipped by 29 July 2026.** Form 8-K Exhibit 99.1 (Q2 2026 shareholder letter):

> "With the launch of Agentic Trading in May, customers are now able to trade equities,
> options, and crypto through AI-powered agents. To date, **nearly 100 thousand customers have
> opened Agentic Trading accounts, with over $100 million in AUC**."

The support docs corroborate with operational detail that only exists for a live product: a
Robinhood Crypto account must correspond to the Agentic account, the updated crypto customer
agreement must be accepted, and crypto agentic trading "isn't available in every state,
including New York," with access restored 45 days after moving to a supported state.

**But "digital assets" here means custodial crypto, not onchain.** Robinhood's own support
documentation draws the line explicitly:

> "Your agent can trade crypto, but it **can't transfer, stake, or lend it**. Those actions
> need to be done by you directly in the app."

> "Your agent can only place crypto trades in your Agentic account, and only for currency
> pairs that are **tradable at Robinhood**."

Cryptocurrency is "offered through an account with Robinhood Crypto, LLC" and is "not FDIC
insured or SIPC protected" — a custodial venue, not a wallet. Searching the documented
57-tool surface for `transfer`, `wallet`, `bridge`, `stake`, `lend`, `withdraw`, `deposit` or
`onchain` returns **nothing**. There is no tool by which an agent could move an asset out of
Robinhood's custody, which is the minimum precondition for touching any blockchain.

**Onchain agentic accounts: not shipped, and not announced.** No primary source describes any
product, beta, waitlist, or roadmap item for an agent transacting from a self-custody wallet
or on Robinhood Chain.

## 4. Any official statement on agents transacting on chain 4663 vs the brokerage API?

**No statement exists — but the documentation answers it by omission and by construction.**

All 20 pages of the Robinhood Chain developer documentation at `docs.robinhood.com/chain`
were fetched and searched. **No page mentions "agentic", "MCP", or "ERC-8004".** The word
"agent" appears five times, every one of them boilerplate legal language in the Terms of
Service ("officers, directors, employees, contractors, agents…"). The docs' own navigation —
Get Started, Stock Tokens, Core Concepts, Build (Deploy a Contract, Account Abstraction,
Cross-Chain Messaging, Oracles & Price Feeds, Data Streams), Run a full node, Governance —
contains no agent section. The Robinhood Chain *support* section likewise contains no agentic
content.

This matches the Phase 0 recon finding that the live ERC-8004 identity registry at
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` is not referenced anywhere in Robinhood's
developer documentation. It is on the chain; it is not Robinhood's.

The 10-Q is explicit that Robinhood does not drive chain activity:

> "Robinhood Chain … is designed to be permissionless and developer-friendly, meaning that, in
> supported jurisdictions, developers can deploy or build smart contracts and applications and
> users can access, or transfer on Robinhood Chain, in each case **without our approval**. As a
> result, much of the activity that occurs on Robinhood Chain is conducted by independent third
> parties — including developers, applications, and users — and may be **difficult or impossible
> for us to monitor, influence, prevent, or reverse**."

So the two venues are disjoint by design: the brokerage API is where Robinhood's agents
execute, and the chain is a permissionless network Robinhood explicitly disclaims control over.

## 5. The jurisdictional split, which is the harder constraint

The two products do not merely fail to connect. They are aimed at **mutually exclusive**
populations, and both restrictions are legal rather than technical.

| | Agentic Trading | Stock Tokens on chain 4663 |
|---|---|---|
| Who may use it | **US customers only** (Form 10-Q, 30 Jul 2026) | **Non-US persons only** |
| Legal basis | US broker-dealer registration (RHF/RHS/RH Crypto) | Regulation S, Securities Act of 1933 |
| Custody | Robinhood custodial | Self-custody (Robinhood Wallet / any wallet) |
| Issuer | — | Robinhood Assets (Jersey) Limited |

From `docs.robinhood.com/chain/stock-tokens`:

> "Stock Tokens have not been and will not be registered under the U.S. Securities Act of 1933
> … Stock Tokens **may not be offered, sold or delivered within the United States to, or for
> the account or benefit of U.S. Persons** (as defined in Regulation S), and (ii) may be
> offered, sold or otherwise delivered at any time only outside of the United States and to
> transferees that are not U.S. Persons."

The ~100,000 agentic accounts are US accounts. Stock Tokens may not be delivered to US
persons. **The population that has an agent is the population legally barred from holding the
asset**, and closing that gap requires a securities registration, not a feature.

## 6. What this means for the market-size measurement

[`MARKET_SIZE.md`](./MARKET_SIZE.md) counted ERC-8004-registered agents trading Stock Tokens
on chain 4663 and found one benchmarkable address with four movements. That number is correct
and reproducible. Its *interpretation* needs narrowing, in both directions:

- **The absence is not evidence that agent trading is rare.** It was ~100,000 accounts and
  >$100M AUC as of 29 July 2026 — all of it in the brokerage, none of it visible on any chain,
  none of it reachable by `eth_getLogs`. A scoreboard reading chain 4663 was never going to see
  Robinhood's agents.
- **The chain is not "closed".** Chain 4663 is permissionless and has been open since 1 July
  2026; anyone can deploy an agent on it today. What has not shipped is a *Robinhood* product
  that routes agents there. "The venue isn't open yet" would overstate it; "nothing routes
  agents to this venue, and the two user populations are legally disjoint" is the accurate
  claim.
- **The ~51 sustained automated addresses are third parties.** They are not a Robinhood agentic
  product under another name — no such product exists onchain. That is consistent with, and
  strengthens, the market-making reading in MARKET_SIZE §5.
- **The honest conclusion is sharper than "no population exists."** The population exists and is
  large; it is somewhere else, behind a custodial API, in a jurisdiction that cannot hold the
  benchmark asset. An onchain scoreboard cannot measure it, and no amount of indexing fixes
  that.

## Sources

All fetched 2 September 2026 as raw HTML and read directly; no summarizer was in the path
(per [`DECISIONS.md`](./DECISIONS.md) D-0.1).

| # | Source | Date | What it establishes |
|---|---|---|---|
| 1 | [Robinhood newsroom — *Robinhood is Now Open to Agents*](https://robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents/) | 27 May 2026 | MCP launch; equities-only beta; Trading + Banking MCP servers |
| 2 | [Robinhood newsroom — *…Robinhood Chain Mainnet, Stock Tokens, Agentic Trading…*](https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/) | 1 Jul 2026 (updated 30 Jul 2026) | Chain mainnet; options already live; crypto agentic "preparing to launch"; Stock Tokens non-US |
| 3 | [Form 8-K Ex. 99.1 — Q2 2026 shareholder letter](https://www.sec.gov/Archives/edgar/data/1783879/000178387926000113/q22026robinhoodexhibit991.htm) | 29 Jul 2026 | Equities + options + crypto all live; ~100k accounts; >$100M AUC |
| 4 | [Form 10-Q, quarter ended 30 Jun 2026](https://www.sec.gov/Archives/edgar/data/1783879/000178387926000114/hood-20260630.htm) | 30 Jul 2026 | "currently offer to U.S. customers"; chain activity by third parties, outside Robinhood's control |
| 5 | [Support — *Agentic Trading overview*](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) | live | MCP endpoint; account rules; crypto prerequisites; state restrictions |
| 6 | [Support — *Trading with your agent*](https://robinhood.com/us/en/support/articles/trading-with-your-agent/) | live | Full 57-tool surface; "can't transfer, stake, or lend" |
| 7 | [`docs.robinhood.com/chain`](https://docs.robinhood.com/chain/) (20 pages) | live | No agentic/MCP/ERC-8004 content anywhere |
| 8 | [`docs.robinhood.com/chain/stock-tokens`](https://docs.robinhood.com/chain/stock-tokens) | live | Regulation S: not deliverable to US persons |

## Re-verifying this

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0'

# the two newsroom posts and both support articles, raw
curl -sSL -A "$UA" https://robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents/
curl -sSL -A "$UA" https://robinhood.com/us/en/support/articles/trading-with-your-agent/

# every chain doc page, then search the whole set
for p in account-abstraction bridging building-with-stock-tokens connecting contracts \
         cross-chain-messaging data-streams deploy-smart-contracts differences-from-ethereum \
         gas-and-fees governance notices-and-upgrades oracles-and-price-feeds protocol-contracts \
         run-a-full-node stock-token-apis stock-tokens terms-of-service transaction-finality \
         add-network-to-wallet; do
  curl -sSL -A "$UA" "https://docs.robinhood.com/chain/$p" -o "chaindocs/$p.html"
done
grep -rilE "agentic|\bMCP\b|erc-?8004" chaindocs/   # expected: no matches
```

SEC filings are indexed at `https://data.sec.gov/submissions/CIK0001783879.json` (send a
User-Agent with a contact address, per SEC policy). A newer 10-Q or 8-K is the place to check
whether the position in §3 and §4 has changed.

**Scope note.** This document verifies where Robinhood's agent product executes. It changes no
scoring rule: the universe is still ERC-8004 self-declared, scoring still starts at the
registration block and is never backfilled, and nothing here enters any leaderboard.
