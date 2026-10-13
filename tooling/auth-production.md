# Homepage and login production service

Build a clean release of the committed branch with Node.js >= 22 and pnpm.
Install dependencies using the lockfile, then run:

```sh
pnpm --filter @qitu/auth-portal typecheck
pnpm --filter @qitu/auth-portal lint
pnpm --filter @qitu/auth-portal build
```

Install `tooling/qitu-auth.service` in `/etc/systemd/system/`, run
`systemctl daemon-reload`, and enable/start `qitu-auth.service`.
The unit runs from the canonical checkout `/root/team-workspaces/qitu-zhixue`;
there is no `qitu-auth-current` release symlink any more (the earlier
symlink-based scheme was dropped — keep the unit file and the host in sync).
Port 3100 must be free before starting it. Manage this frontend through
systemd; do not launch a second `next dev` process on this port.

Never build into the `.next` directory a running process is serving. Stop the
service (or the script-owned process on that port), build in place, then start
again — `bash tooling/start-qitu-services.sh stop && ... build && ... start`
handles all five frontends in one pass. `next start` without a production
`.next/BUILD_ID` crash-loops the unit and Nginx returns 502 on `/` and `/login`.

Apply the gzip and `/_next/static/` location from
`tooling/qtzx.jaycue.tech.conf` to the existing Nginx site, preserving its
other routes. Run `nginx -t` before reloading. Cache only the versioned
static assets; login pages and authentication API responses must not be
cached by this rule.

Verify `/` and `/login` return 200, static assets advertise immutable
caching and gzip, and `/api/v1/auth/login` still reaches the backend.
This changes no database schema, account data, or permission checks.

The public About page is served at `/about`. Verify the homepage About link
on desktop and mobile, and the About page's homepage and `/login` links.
Its content is statically rendered from the supplied design and requires no
new API. Verify `/api/v1/auth/login` still returns `401 INVALID_CREDENTIALS`
for a nonexistent account, and a real test account can reach its role's app.
