---
'shoehive': minor
---

WebSocket upgrades to paths Shoehive does not serve no longer hang. `listen()` answers them with HTTP 404 and closes the socket. `attach()` keeps leaving them to other `upgrade` listeners by default, and the new `unknownUpgrades` server option (`'ignore' | 'refuse' | { refuseAfterMs }`) can refuse them at once or after a delay when no other listener takes the socket. Refused upgrades (401, 403, 404, 500) now destroy the socket after the response instead of leaving it half open.
