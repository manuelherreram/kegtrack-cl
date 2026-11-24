# KegTrack CL

Mobile-first keg inventory for a Chilean brewery with a taproom and B2B deliveries. The operator interface uses Chilean Spanish. This guide and the code comments describe the technical setup in English.

## Start locally

You need Docker with Compose v2. The first build downloads public images and npm dependencies. The running application uses your local PostgreSQL database and bundled assets, including its QR generator and scanner.

1. Copy `.env.example` to `.env`. Run `openssl rand -hex 24` twice and set `DB_OWNER_PASSWORD` and `DB_APP_PASSWORD` to the two different outputs. Set `ADMIN_EMAIL`, `ADMIN_NAME` and a unique `ADMIN_PASSWORD` of at least 12 characters. Use hex for the database passwords so they can be included in a PostgreSQL URL.
2. Start the database and app, and create the administrator.

   ```sh
   docker compose up --build -d --wait
   docker compose run --no-deps --rm migrate npm run db:bootstrap
   ```

3. Open [http://localhost:3000](http://localhost:3000) and sign in. The app binds to the host loopback address by default. Clear `ADMIN_PASSWORD` from `.env` after the bootstrap. The account lives in PostgreSQL. In **Equipo**, create individual **Personal** accounts.

To add sample beers, kegs and Chilean clients to a fresh demo database, run:

```sh
docker compose run --no-deps --rm migrate npm run db:seed
```

The demo includes `BRL-003` in the cold room, `BRL-005` and `BRL-006` ready for bulk filling, `BRL-007` to sanitize and `BRL-004` in an overdue comodato. Repeat seed runs preserve existing records with matching codes. Keep the demo database separate from live inventory.

`docker compose down` stops the stack and preserves the database volume. Before upgrades, save an off-host backup and test restoring it. For example:

```sh
docker compose exec -T db pg_dump -U kegtrack_owner -Fc kegtrack > kegtrack.dump
```

## Phone camera on Wi-Fi

1. Set `LAN_HOST` in `.env` to the Docker host's Wi-Fi IPv4 address. Keep the phone and host on the same trusted network.
2. Start the optional Caddy HTTPS service and copy out its public root certificate:

   ```sh
   docker compose --profile lan up --build -d --wait
   docker compose --profile lan cp caddy:/data/caddy/pki/authorities/local/root.crt ./kegtrack-local-root.crt
   ```

3. Transfer that root certificate to each authorized phone and trust it using the device's certificate settings. On iOS, install the profile and enable full trust in **Settings → General → About → Certificate Trust Settings**. On Android, the certificate installer is typically under **Security → Encryption & credentials → Install a certificate → CA certificate**. Menu names depend on the device. [Apple certificate trust instructions](https://support.apple.com/en-us/102390)
4. Open `https://<LAN_HOST>:8443` on the phone, sign in, and tap **Escanear → Abrir cámara**. Grant camera permission. HTTP on the host's Wi-Fi IP does not provide a secure context for the phone's browser. Keep Caddy's private CA key inside the persistent `caddydata` volume and distribute only `root.crt`. [Caddy local TLS](https://caddyserver.com/docs/caddyfile/directives/tls) · [Browser camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## Inventory workflow

| Current state | Actions |
| --- | --- |
| Sucio / vacío | Sanitize. Admins can send it to maintenance or retire it with a reason |
| Limpio | Fill with measured liters from a released lot in **Escanear** or **Lotes**. Admins can send it to maintenance or retire it with a reason |
| Cámara de frío | Assign a tap line, deliver to a client, or record beer discarded with a reason |
| Pinchado en barra | Adjust estimated liters, mark empty, return to cold storage with beer, or record a discard |
| En cliente / Comodato | Record an empty return or return to cold storage with the measured remaining volume |
| Mantención | Return to inventory as dirty or retire with a reason, both as admin |
| Dado de baja | Archived from the active registry. History remains accessible |

- Administrators manage the registry, batches, clients, staff and maintenance. Staff can scan, fill kegs, record delivery and return, and operate taps.
- To retire an eligible keg, an administrator opens its record in **Barriles**, selects **Dar de baja**, and confirms with a reason. The registry defaults to active kegs. Select **Dado de baja** in the **Estado** filter to find retired records and their movement history.
- On a keg's record, **Editar ficha** lets an administrator correct the connector, notes, and capacity when empty. **Deshacer último movimiento** restores the state before the latest reversible action and records who corrected it and why. Undoing a fill restores its recorded liters to the lot's available balance. The original event remains in the report and is marked corrected. Moves created before this upgrade remain visible and lack the snapshots needed for undo.
- In **Barriles**, filter by code, beer, client, status or connector. **Etiquetas de esta página** prints the current page of the filtered registry as an A4 grid. Each label contains the keg code, capacity and a QR encoding the code itself. Labels keep working if the app's address changes.
- In **Lotes**, add a beer to **Catálogo de cervezas** and reuse it for each new lot. Enter the total liters available for packaging, including any already recorded in kegs. New lots start **En retención**. Open the lot to release it or change its volume with a reason. Release permits fills, taps and deliveries from the fill date through the best-before date, inclusive, in Chilean local time. Use the hold state to suspend those operations. Staff can still return or drain a held keg.
- **Saldo para llenar** is the lot's unallocated beer. A partial return or discard changes the keg's remaining volume. Its original fill stays in the lot's allocated volume.
- Open a lot to see its current kegs and all recorded moves, including earlier deliveries, returns, discards and corrections. **Descargar CSV** exports that timeline in UTF-8 with semicolon delimiters and UTC timestamps.
- Client custody starts when staff record delivery. The 30-day alert uses calendar days in `America/Santiago`. Delivery guide references are entered manually and guarantees are stored as integer CLP.
- Inventory volume is an estimate entered by staff. The app stores current assignments separately from the movement history, so marking a keg empty or recording a return clears its live assignments while retaining their details in history.

### Upgrade an existing local database

Use the regular Compose build and startup command to run the new migration. It derives catalog entries from existing names and styles, preserves lot and keg history, and estimates previously allocated liters from recorded fills and nominal capacity for seeded opening inventory. Migrated lots start **En retención** with their total volume unconfirmed. Confirm each lot's total before releasing it. Existing deliveries and tap assignments remain visible and can be returned or drained during the review.

## Project layout

```text
kegtrack-cl/
├── docker-compose.yml         Database, migration job, web app and optional LAN TLS
├── Dockerfile                 Node tools and runtime, Postgres init and Caddy
├── .env.example               Local configuration template
├── infra/                     Local PostgreSQL role bootstrap and Caddy config
├── prisma/
│   ├── schema.prisma          Domain, user accounts and sessions
│   ├── migrations/            Committed PostgreSQL schema and guardrails
│   ├── bootstrap.ts           One-time administrator creation
│   └── seed.ts                Opt-in fictional inventory
├── src/
│   ├── app/                   Next.js pages, global CSS and health route
│   ├── components/            Forms, mobile navigation, camera and QR printing
│   └── lib/                   Authorization, validation and inventory transactions
└── tests/                     Domain and PostgreSQL regression tests
```

## Data integrity and deployment

Auth uses individual credentials and server-side PostgreSQL sessions. Each write checks the current account and records its user ID. The live keg row and the audit entry share a transaction. Mutating forms carry the keg version they displayed, so a duplicate submission or concurrent scan cannot overwrite newer state. Bulk filling commits as one transaction. PostgreSQL enforces a unique occupied tap line, capacity and custody constraints, and an append-only `keg_movements` table. The runtime database role can read and append history, and the database rejects updates, deletes and truncation of that table.

The app image is stateless. For AWS, build the `app` and `tools` targets and push them to ECR. On a private RDS PostgreSQL database, create a migration owner and a separate login role named `kegtrack_app` before applying the first migration. Pass the owner connection URL to a one-off `tools` task and the runtime role URL to the web service. Use Secrets Manager and certificate-verified PostgreSQL TLS. Run the migration task before rolling out the new application image. Deploy the app behind an HTTPS ALB with an ACM certificate and use `/api/health` for health checks. Keep the app and database behind private security groups, configure backups, and deploy replicas from the same image so they share the Server Actions build key. [Prisma deployment migrations](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production)

## Checks

With Node 22 and npm installed, run `npm ci`, `npm run typecheck`, `npm test` and `npm run build`. For the PostgreSQL regression test, point `DATABASE_URL` at a disposable migrated database and run `KEGTRACK_TEST_DB=1 npx tsx --test tests/inventory.integration.ts`. It creates its own test fixtures.
