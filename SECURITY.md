# Security policy

Shoehive runs game servers that hold player sessions and, optionally, connect to wallets. Please
report vulnerabilities privately.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/jtay/shoehive/security/advisories/new).
Do not open a public issue. You should get a reply within 7 days.

## Supported versions

Only the latest `1.x` prerelease or release receives fixes. The `0.x` line is unsupported.

## Scope notes

Shoehive is not a licensed gaming system. Operators running real-money games are responsible for
regulatory compliance, audit and fairness certification.

## Reviews

Before 1.0, the code was reviewed in two parts. Both found no Critical issues, and every High
and Medium finding was fixed with a regression test, except the items each write-up lists as
accepted risks with reasons:

- [Network surface](docs/security/review-1.0-network.md): server, protocol parsing, transports,
  resume tokens, client.
- [Platform](docs/security/review-1.0-platform.md): devtools, stores, wallet and engine,
  fixture export, the `create-shoehive` template, CI and supply chain.

Operators should read the accepted risks, in particular: guest resume tokens are bearer tokens
(ADR 0010), connection limits per address belong at your reverse proxy, and devtools with
`allowRemote` is only as safe as its token and transport.
