# Box Game

[Play Box Game](https://boxes.chrisawad.com/)

Connect adjacent dots to draw a line. Completing the fourth side claims the box and earns another turn. A shared edge can capture two boxes. When all lines are drawn, the player with the most boxes wins.

- **Solo** challenges a computer that avoids giving away boxes, measures chains, and solves the final 16 lines exactly.
- **Local** lets two players share a device. Solo and local matches resume on reload and work offline after the game has been cached.
- **Online** pairs two browsers using PeerJS and a reliable WebRTC data channel. Host a private room and share its six-character code, invite link, or QR code. Public search pairs available players who chose the same board dimensions.

The host validates moves and sends board updates to the guest. PeerJS Cloud introduces the browsers. A shared Cloudflare TURN service can relay play when a direct connection fails. The scoreboard shows the negotiated route. On Android Chrome, reopening Box Game or the original invite on the same device restores your seat and board. You can view the saved board offline. Play resumes when both players reconnect. Choosing Leave room clears your seat. An installed app can reopen a waiting host room for two hours. Both players can vote to play another round. QR codes are generated on the device.

The portable multiplayer module is in [src/multiplayer](src/multiplayer/README.md). To sync it to Tic-Tac-Toe, copy that directory. Box Game supplies its board rules, queue keys and existing protocol settings in [src/online.ts](src/online.ts). The Pages build reads the public relay credential endpoint from the repository variable `TURN_WORKER_URL` and passes it to Vite as `VITE_TURN_WORKER_URL`.

## Development

Use Node 24 and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm test:e2e
```

The game uses Vite, TypeScript, Three.js, Tailwind CSS, Workbox, and canvas-confetti. Fonts and install icons ship with the app. GitHub Actions tests the game and publishes the production build to GitHub Pages on pushes to main.

For a self-hosted release, set `PWA_ORIGIN` to your public origin (for example, `https://games.example.com`) when running `pnpm build` so desktop browsers can recognize an existing installation. The Pages workflow supplies this automatically.

For isolated multiplayer tests, build with `VITE_PEER_HOST=127.0.0.1`, `VITE_PEER_PORT=9108`, `VITE_PEER_SECURE=false`, and `VITE_TURN_WORKER_URL=/test-turn-credentials` using `pnpm exec vite build --outDir .qa/peer-ci`. Then run `pnpm test:e2e` with `PEER_CI=1`. Playwright starts its own PeerServer. To smoke-test the deployed private room flow, set `PLAY_URL` to the published Pages URL and `ONLINE_SMOKE=1`, and run `pnpm exec playwright test tests/online.e2e.ts --project=desktop`. To verify a real TURN retry between two browser processes, use the same `PLAY_URL` with `LIVE_TURN_TEST=1` and run `pnpm exec playwright test tests/relay.e2e.ts --project=desktop`.
