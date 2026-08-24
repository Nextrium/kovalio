# Installing Kovalio

Kovalio runs in three shapes. Pick by **who uses it** and **whether it must be reachable when your machine is off**.

| Setup | Use when | How Kovalio runs |
|---|---|---|
| **Desktop app** | It's just you. Private. | Control plane runs **on your machine**, drives your server(s) over SSH. Nothing about Kovalio is exposed to the internet. |
| **Self-hosted on a server** | A team, always-on, remote access, CI / push-to-deploy | Control plane runs **on a Linux box** at a public URL, login required, invite-only. |
| **Kovalio Cloud** | Zero ops | Managed for you. |

---

## Solo / private → use the Desktop app (recommended)

For a single operator this is the best model: the control plane lives **locally** and manages your servers end-to-end over SSH. Kovalio itself has **no public app and no open port** — the only thing that ever goes public is an app *you* give a domain to. Smallest attack surface, nothing to secure.

**When this is the wrong choice:** the dashboard is only up while your machine is. No teammate access, no access from your phone, and push-to-deploy webhooks need a stable public endpoint your laptop isn't. If you need any of those, run Kovalio on a server (below).

**Install:**
- Download for your OS at [nextrium.org](https://nextrium.org), or run `kovalio install` (fetches the desktop build).
- On first launch, connect what you want to manage:
  - **This Machine** — manage the local box.
  - **Another Server** — add a remote server over SSH (host, user, key). Test Connection, then manage it.

---

## Team / always-on → install Kovalio on a server

Two ways to stand up the control plane on a Linux box. Point your domain's **DNS A record at the server first**.

### A) From the Desktop app

Add the server (SSH), then **install Kovalio onto it like any other app** — pick the server, install Kovalio, and it runs as an always-on app on that box with its own domain. Use this to promote from "local desktop control" to "always-on server" without touching a terminal.

### B) With the CLI (on the server)

Install the CLI, then just run **`kovalio`** — an interactive wizard walks you through it: it creates the **first admin**, attaches your domain, and installs Kovalio as a boot service. Run `kovalio` again later to manage the running instance.

```bash
curl -fsSL https://get.kovalio.nextrium.org | sh      # install  (or: npm i -g kovalio)
kovalio                                     # interactive setup, then control panel
```

Prefer a one-shot, flag-driven setup for CI / headless boxes? Drive `kovalio up` directly instead of the wizard:

```bash
kovalio up --public-url https://ops.example.com
```

- `kovalio up` installs the same background service the wizard does (starts on boot, auto-restarts), driven entirely by flags.
- `--public-url <url>` makes the dashboard reachable at your domain. Login is required; everyone else joins by invite only.
- `--managed-edge` also installs OpenResty + a free Let's Encrypt cert on the box and routes your domain to the dashboard — no separate reverse proxy needed. Omit it if you run your own proxy in front.
- One-off attached run instead of a service: `kovalio up --foreground`.

Once it's up, **Kovalio registers itself as an app** (dashboard → Apps → *Kovalio*): manage its domain, tail its logs, and see it *Live* like any other app.

---

## Docker

Self-host the pull-based stack — Postgres, Redis, API, dashboard, and the OpenResty edge on :80/:443. It lives in `docker/docker-compose.yml` and pulls published images (no build). Run it from the repo root:

```bash
git clone https://github.com/Nextrium/kovalio.git && cd kovalio
cp .env.example .env
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Linux only (the edge needs host networking); pin `KOVALIO_VERSION` in `.env` for reproducible upgrades, and build from source instead with `-f docker/docker-compose.build.yml … up -d --build`.

> The repo-root `docker-compose.yml` is a different file — the SaaS / from-source control plane (builds from source, ships the marketing site, no edge or Docker socket). It does not self-host your apps.

### Postgres won't start (`could not write to file … Operation not permitted`)

If the `postgres` container aborts during first boot with an `initdb` error like `could not write to file "pg_wal/xlogtemp.NN": Operation not permitted`, the database volume is on a filesystem that rejects the low-level operations Postgres needs (this is an `EPERM`, not a permission/uid problem). New installs already keep the data directory in a subdirectory of the volume (`PGDATA=/var/lib/postgresql/data/pgdata`) to sidestep the common variants automatically, so first clear the aborted volume and retry:

```bash
docker compose -f docker/docker-compose.yml down -v   # removes the half-initialized volume
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

> **Upgrading an older raw-`docker compose` install** whose database was created at the volume root (before this default)? Set `PGDATA=/var/lib/postgresql/data` in your `.env` before `up`, or Postgres will initialize a fresh empty database. Your old data is never deleted — it stays in the volume, unused, until you point `PGDATA` back. (The `kovalio up` CLI handles this automatically.)

If it still fails, the incompatibility is at the host/kernel level. Check:

```bash
systemd-detect-virt                                   # openvz / lxc  => the host is the problem
df -T "$(docker info -f '{{.DockerRootDir}}')"        # nfs/cifs/fuse/zfs => data-root is the problem
```

Fix by moving Docker's data-root to a native `ext4`/`xfs` disk (`/etc/docker/daemon.json` `"data-root"`, then restart Docker), or use a KVM-based VPS rather than an OpenVZ/LXC one. See [#350](https://github.com/Nextrium/kovalio/issues/350).

---

## Users & access (self-hosted)

- **Public signup is disabled after the first account.** The first admin comes from the `kovalio` setup wizard; with `kovalio up --compose` (or raw Docker) you register the first account in the dashboard. Everyone after joins by invite.
- **Invite teammates** from **Settings → Team**. They get an accept link at your instance's URL (so the instance needs to be reachable — a public URL or your LAN).
- **Lost the admin password?** Run `kovalio reset-admin-password` on the box (no sign-in needed; uses the local internal token).

---

## CLI reference

### Run & manage the instance
| Command | Does |
|---|---|
| `kovalio up [--foreground]` | Start Kovalio as a service (boot + auto-restart); `--foreground` runs it attached |
| `kovalio up --public-url <url> [--managed-edge]` | Serve the dashboard at a public domain (+ install OpenResty/TLS with `--managed-edge`) |
| `kovalio stop` | Stop the service |
| `kovalio status [--json]` | Is it running? Resolved ports + API health |
| `kovalio open` | Open the dashboard in your browser |
| `kovalio update` | Update the CLI + bundled server to the latest release |
| `kovalio reset-admin-password` | Reset the local admin login on this machine (no sign-in) |
| `kovalio install` | Download the desktop app for this OS |
| `kovalio doctor` | Diagnose the CLI setup (config, context, runtime) |

### Deploy & inspect
| Command | Does |
|---|---|
| `kovalio init` | Link the current directory to a project (`.kovalio/project.json`) |
| `kovalio deploy` | Trigger a deployment for the current project |
| `kovalio logs <deploymentId> [-f] [--tail N]` | View or stream a deployment's logs (`-f` = live) |
| `kovalio deployment` | List / manage deployments |
| `kovalio project` | List / manage projects |
| `kovalio service` | Services within a stack |
| `kovalio domain` | A project's domains |

> Health + logs for the control plane itself: `kovalio status`, and `kovalio logs <kovalio-app-deployment-id>` streams the running instance's own logs (Kovalio is a real app — find its deployment id under Apps → Kovalio → Deployments).

### Infrastructure & admin
| Command | Does |
|---|---|
| `kovalio server` | Manage self-hosted SSH servers |
| `kovalio system` | Read / update instance settings |
| `kovalio mail` | Mail server setup |
| `kovalio backup` | Backup policies (schedules) for a project |

### Auth, config & automation
| Command | Does |
|---|---|
| `kovalio login` / `logout` | Authenticate with a Personal Access Token (create one in dashboard Settings) |
| `kovalio context` | Manage contexts — which instance the CLI talks to |
| `kovalio token` | Manage personal access tokens |
| `kovalio api <method> <path>` | Authenticated request to any API route (like `gh api`) |

Add `--json` to most read commands for scripting.

For alternate certificate authorities, EAB credentials, or a private ACME root,
see [Custom ACME certificate authorities](acme.md).

---

## Quick decision

- **Just you, private** → Desktop app.
- **Team / always-on / public / CI** → `kovalio up --public-url https://… --managed-edge` on a server.
- **No ops at all** → Kovalio Cloud.
