# Security policy

VaultSnip's core promise is that sensitive text never leaves the user's device unmasked. Anything that breaks that promise is treated as a security issue.

## What counts as a security issue

- Sensitive text (names, numbers, IDs, emails) left readable in the image that is sent, or in an exported replica
- The pre-flight check passing when readable text is still present
- Any network request that sends data the user did not approve, or that stores user data
- An API key exposed beyond the user's own browser and Anthropic
- Code injection through a crafted screenshot, spec or exported file

## How to report

**Please do not open a public issue.** Use one of these private routes:

1. **GitHub private report (preferred):** [Report a vulnerability](https://github.com/karthikvalluri85/vaultsnip/security/advisories/new)
2. **Email:** use **Feedback → Something was not masked → Email instead** in the app, which addresses the message to the maintainer.

Describe the problem **without the real data**, for example "an 8-digit account number in a table column stayed readable on a dark background". If an image helps, recreate the case with fictional values. Never send an original client screenshot.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement | within 5 business days |
| Assessment and plan | within 14 days |
| Fix released | as soon as practical; masking misses are prioritised |

You will be credited in the release notes unless you prefer otherwise.

## Supported versions

Only the latest release, which is what the web app at https://vaultsnip.pages.dev serves, receives fixes.
