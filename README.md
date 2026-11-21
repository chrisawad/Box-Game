# Box Game

[Play Box Game](https://chrisawad.github.io/Box-Game/)

Connect adjacent dots to draw a line. Completing the fourth side claims the box and earns another turn. A shared edge can capture two boxes. When all lines are drawn, the player with the most boxes wins.

- **Solo** challenges a computer that avoids giving away boxes, measures chains, and solves the final 16 lines exactly.
- **Local** lets two players share a device. Solo and local matches resume on reload and work offline after the game has been cached.
- **Online** pairs two browsers using PeerJS and a reliable WebRTC data channel. Host a private room and share its six-character code, invite link, or QR code. Public search pairs available players who chose the same board dimensions.

The host validates moves and sends board updates to the guest. The PeerJS Cloud service introduces the browsers. Keep the host tab open during play. Refreshing the same tab restores its seat and reconnects. Network policies that block WebRTC can prevent pairing. QR codes are generated on the device.

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

For isolated multiplayer tests, build with `VITE_PEER_HOST=127.0.0.1`, `VITE_PEER_PORT=9108`, and `VITE_PEER_SECURE=false` using `pnpm exec vite build --outDir .qa/peer-ci`. Then run `pnpm test:e2e` with `PEER_CI=1`. Playwright starts its own PeerServer. To smoke-test the deployed private room flow, set `PLAY_URL` to the published Pages URL and `ONLINE_SMOKE=1`, and run `pnpm exec playwright test tests/online.e2e.ts --project=desktop`.
