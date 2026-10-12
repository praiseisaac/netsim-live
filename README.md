# NetSim Live

A live exercise from NetSim's week 2, for a class or a group of friends: four of you act out a
tiny computer (CPU-1, CPU-2, MEMORY and a BUTTON) and one person is the **bus** and the **clock**.
Everyone opens a link in a browser. The players send messages through the bus, the bus delivers
them or drops them, and everyone else watches the timeline and notes what goes wrong. When you're
done, **End and export** writes a replay page that anyone can open later, even with the server
gone.

It's one small Node server with no database and no accounts. TypeScript runs through
[tsx](https://tsx.is), so there's no build step.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

It prints two links:

```
[live] students: http://127.0.0.1:4870/
[live] you, the bus and the clock (this computer only; keep it to yourself): http://127.0.0.1:4870/teach#t=…
```

- **The students' link** is for the players and the watchers. They type a name and wait to be
  given a part.
- **The instructor link** is yours. It carries a secret token (after `#t=`) that is made new each
  time the server starts, and it only works on the computer running the server. Open it yourself:
  nothing opens on its own.

Stop the server with Ctrl-C.

## Play

On the instructor page:

1. **Fill empty roles** (or pick a part from each person's menu). Everyone else watches.
2. **Show MEMORY only** gives MEMORY its four private bytes (addresses 0 to 3).
3. **Start tick 1.** The players pick a message (`mem.read`, `mem.data`, `fault` or `irq`) and send
   it to the bus. Each message waits in **The bus** until you **Deliver** it or **Drop** it.
4. The next tick waits until every player has pressed **Done**. (**Start the next tick anyway**
   doesn't wait.)
5. Afterwards, talk it over: who owns time? What does the bus know about the CPUs? What should
   happen when someone asks for address 9?
6. **End and export** writes the record (see below). **Reset** starts again, either keeping
   everyone in their parts or clearing everyone so they join again.

The send form only offers messages the player's part can send. It shows what's wrong in red, and
Send stays off until the message is right. The server checks everything again, so nobody can get
around the form. Every page shows "The machine", a live diagram of the parts and the bus.

## Play with friends

- **On one computer:** open the students' link in a few browser windows. Use a private window or
  another browser for each person, because each window keeps its own seat.
- **On your network** (the same Wi-Fi): `npm start -- --lan`. The students' link becomes your
  computer's network address, such as `http://192.168.1.20:4870/`. Anyone on that network can
  open it, so stop the server when you're done. The instructor link still works only on your own
  computer.
- **Over the internet:** put it behind a tunnel (next section).

## Put it on your own domain (optional)

The server only listens on 127.0.0.1, and a tunnel connects to it from your computer. With
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

- **Quick, no account:** `cloudflared tunnel --url http://127.0.0.1:4870` prints a temporary
  `https://…trycloudflare.com` address. Give students that address, and start the server with it
  so your instructor page shows it too:
  `npm start -- --public-url https://….trycloudflare.com/`
- **On your own domain** (the domain must be on your Cloudflare account):

  ```bash
  cloudflared tunnel login                     # once: pick the account and the domain
  cloudflared tunnel create netsim-live        # once
  cloudflared tunnel route dns netsim-live live.example.org    # once: your own name
  cloudflared tunnel run --url http://127.0.0.1:4870 netsim-live
  npm start -- --public-url https://live.example.org/
  ```

  `--url` sends everything on the tunnel to this server, and to nothing else. Nothing here hard-codes
  a host name: yours goes in `--public-url`.

Through a tunnel, the instructor page and its controls answer **404**, even with the right token.
Run the class from the computer the server is on.

## Options

```
npm start -- [--port 4870] [--exercise week-02-act-it-out] [--out ./exports] [--lan]
             [--public-url https://…/] [--link-file <path>]
```

| Option | What it does |
|---|---|
| `--port` | the port (default 4870) |
| `--exercise` | which exercise, from `src/exercises.ts` (`npm start -- --help` lists them) |
| `--out` | where exports go (default `./exports`) |
| `--lan` | let other computers on your network open the students' link |
| `--public-url` | the students' link to show, for example your tunnel's address |
| `--link-file` | also write your instructor link to this file, readable by you only (it must not exist yet) |

## After the session: the export

**End and export** writes these files to the exports folder (`./exports` unless you chose another):

- `week-02/<date>.json`: the whole session. That's the names, the parts, every message with the
  tick it was sent in and the tick it was delivered or dropped in, the notes, and the event log.
  It has no seat ids or tokens.
- `week-02/<date>.html`: the replay, tick by tick, with popovers that explain the jargon. It's one
  self-contained file that works offline. Open it in any browser or share it.
- `week-02/index.html`: every session for that week, newest first.

A second session on the same day becomes `<date>-2`. Nothing is ever overwritten.

## Add an exercise

An exercise is data: one `ExerciseDef` in `src/exercises.ts`. The engine and the pages stay as
they are.

```ts
export const MY_EXERCISE: ExerciseDef = {
  id: "my-exercise",            // npm start -- --exercise my-exercise
  week: 3,                      // exports go to exports/week-03/
  title: "…",
  summary: "…",                 // one or two sentences, shown on the replay
  instructor: "the bus and the clock",
  roles: [
    // idPrefix numbers that part's messages (a-1, a-2, …); secret is shown to that part only,
    // once you press "Show … only".
    { id: "a", label: "A", job: "What A does, in a sentence.", idPrefix: "a-", secret: "Only A sees this." },
    { id: "b", label: "B", job: "…", idPrefix: "b-" },
  ],
  rules: ["…"],
  examples: ["A → bus:  id=a-1 to=b ping"],
  questions: ["What did you notice?"],
  glossary: ["tick"],           // terms from glossary/glossary.json, explained on the replay
  // Optional: fixed messages, picked from a list and checked field by field. Without them,
  // a message is free text.
  messages: [
    { kind: "ping", hint: "Say hello.", from: ["a"], to: ["b"] },
    { kind: "pong", hint: "Answer a ping.", from: ["b"], to: "reply", answers: ["ping"],
      arg: { name: "count", kind: "number", min: 0, max: 9, hint: "How many." } },
  ],
};
```

Then add it to `EXERCISES` at the bottom of the file. A message whose `to` is `"reply"` goes back
to whoever sent the message it answers, and the player picks that message from their inbox. To
explain a new term on the replay, add it to `glossary/glossary.json`.

## Tests

```bash
npm test            # the engine, the export and the server, over real HTTP
npm run typecheck
```

## Threat model

The server is meant to face the internet through a tunnel, from your own computer, for about an
hour at a time. This section covers what it defends and how.

- **What an attacker could want:** your computer (its files and a shell), the instructor
  controls (run the clock, see MEMORY's bytes, end or reset the session), another student's seat,
  or other people's browsers (a script injected into the pages or the export, which you may share).
- **Nothing else is reachable.** The server reads only its own `src/public/` files and
  `glossary/` when it starts. After that, the only file access is End and export, into the folder
  described below. It runs no other program and has no shell. It listens on `127.0.0.1` only (a
  tunnel connects locally) unless you choose `--lan`.
- **The instructor.** The token is a random 192-bit value, made new at each start and printed
  only in your terminal (and the `0600` link file if you ask for one). It's compared in constant
  time: both sides are hashed, then compared with `timingSafeEqual`. On top of the token,
  `/teach`, `instructor.js` and the instructor API answer **only on this computer**:
  - The request must come from a loopback address, so another computer on `--lan` is refused.
  - It must carry no proxy headers. A tunnelled request has Cloudflare's `cf-connecting-ip`,
    `cf-ray` and `x-forwarded-for`.
  - It must name `127.0.0.1` or `localhost` as its host.

  Anything else gets a 404, even with the right token, and there's no switch to lift this. The
  token travels in the link's `#fragment`, which is never sent to a server or a log, then in a
  header, and it's removed from the address bar.
- **Students.** Joining hands out a random seat token. Every student action names its seat only
  by that token (stored hashed on the server), so nobody can act as another seat. A removed or
  cleared seat's token stops working. A student's view never carries another part's secret, or a
  message the bus hasn't delivered to them; the tests check this.
- **Limits.**
  - Sizes: bodies are at most 2 KB and JSON only. Names are at most 24 characters, ids at most 16
    (letters, digits, `.-_`), messages at most 120 and notes at most 280. Control and
    bidi-override characters are stripped.
  - A session holds at most 60 seats, 400 messages and 300 notes.
  - A whole class can share one campus address, so a student's own actions and streams are
    limited per seat: 20 actions and 10 stream opens per 10 s, and 3 open streams.
  - Per client address the limits are generous: 600 other requests per 10 s, 120 joins a minute,
    45 seats and 100 open streams. There are at most 150 student streams in all; the instructor
    page doesn't count toward that.
  - A reader that stops reading is cut off once 256 KB is waiting for it, and views go out at most
    every 250 ms. Header and request timeouts guard against slow clients.
  - **No new people** closes joining.
- **No injection.** The pages build everything with `textContent`, never HTML from data. The
  Content Security Policy is `default-src 'none'; script-src 'self'; style-src 'self';
  connect-src 'self'` with `frame-ancestors 'none'`. The export escapes every typed string
  (`& < > " '`) and contains one script of its own. The tests feed it `<script>` and `onerror`
  payloads.
- **The export's files.** They go only into `week-NN/` under the exports folder; the week comes
  from the exercise definition and is checked to be a number. A folder that resolves somewhere
  else (a symlink) is refused. File names are the server's own `YYYY-MM-DD[-n]`, written with `wx`
  so nothing is overwritten, and the index is written to a temp file and then renamed. Nothing a
  student types reaches a path.
- **Same origin.** A POST with another site's `Origin` is refused. The tokens travel in headers,
  so a page elsewhere can't act as a student or as you.
- **Privacy.** The export carries the names students typed and everything they sent or noted.
  The join form says so and suggests a first name or a nickname.
- **DNS rebinding.** A hostile page that rebinds its name to `127.0.0.1` reaches the server under
  its own host name, so it isn't "local" and gets no instructor access. The student API it can
  reach is the same one the internet already has.
- **Not defended:**
  - Someone who shares the link, or joins under another student's name. You see the list and can
    remove them.
  - A flood big enough to get past the tunnel's own protection to the rate limits.
  - The session lives in memory, so restarting the server loses it. Export first.

## License

MIT. See [LICENSE](LICENSE).
