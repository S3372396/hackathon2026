# /web: patient journal frontend

React + TypeScript + Vite. Owned by Member 1 (everything here except `src/lib/secureShare.ts`).

```bash
npm install
npm run dev      # http://localhost:5173, uses the mock API
npm test         # Vitest
npm run build    # type-check + production build
```

- `mocks/` holds the MSW mock API and its fake seed data. It stands in for `/server` until the integration swap. State is kept in the browser's localStorage; the **Reset demo** button in the header restores the seed.
- `src/lib/secureShare.ts` is a **plaintext stub** (`STUB: NOT SECURE`). Member 2 replaces it.
- Set `VITE_USE_MOCK=false` (see `.env.example`) to stop using the mock API.
- The shared types live in `../contract/types.ts` and are imported as `@contract`.

Demo path: log mood and symptoms, share the last 7 days of symptoms with the physio, open it as the physio, try it as the GP (denied), withdraw, check the physio is refused, read the audit trail. Use the role switcher in the header to change user.

## Real server and TideCloak (not wired yet)

 is still the plaintext stub, so the UI runs on the mock API. Member 2's real implementation is committed next to it as . It is left out of the type-check () because the web app does not depend on  and  yet or start a TideCloak provider.

Still to do to switch the UI to the real server and encryption:

1. Add  and , start the TideCloak provider and sign-in, and replace the demo role switcher with real login.
2. Make  the . Pass  to  and the  to  (, ).
3. Run entries through  /  wherever the UI reads or writes them (, , , , ).
4. The **Reset demo** button only works on the mock. The server's reset is  in .

Fake data only. Do not enter real health information.
