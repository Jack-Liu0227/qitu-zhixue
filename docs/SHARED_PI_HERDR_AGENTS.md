# Shared Pi Herdr Agent Setup

## Source of truth

Tracked role definitions live in `.pi/agents/`. `tooling/install-shared-pi-agents.sh` copies them into the current OS user's Pi global agent directory (`$PI_CODING_AGENT_DIR/agents`, default `~/.pi/agent/agents`). This global location is shared by all worktrees owned by that user. Existing global agents are preserved; a same-name role is backed up before replacement.

Project-local `.pi/agents` definitions have higher discovery precedence than global definitions. Do not create role overrides in individual worktrees. Update the tracked source, run the installer in the local and remote environments, and reload Pi.

## Local Windows setup

From the repository root in Git Bash:

```bash
bash tooling/install-shared-pi-agents.sh
pi
```

Then run `/reload` and `/subagent list`.

## Remote server setup

Herdr and Pi are per-user tools. Install and configure them as the same Linux user that owns the project worktrees. The expected account is `root` on `study-remote`:

```bash
curl -fsSL https://herdr.dev/install.sh | sh
npm install --global --ignore-scripts @earendil-works/pi-coding-agent
pi install npm:pi-herdr-agents
cd /root/team-workspaces/qitu-zhixue
bash tooling/install-shared-pi-agents.sh
```

Open an interactive SSH terminal with a TTY, enter Herdr, then start Pi from inside Herdr:

```bash
ssh -t study-remote
cd /root/team-workspaces/qitu-zhixue
herdr
pi
```

Verify `/subagent list`, and run a read-only smoke task such as:

```text
/subagent scout Map the repository entry points and report relevant files. Do not modify files.
```

A headless server does not need a graphical display; Herdr is a terminal workspace manager. Subagents require Pi to be launched from a Herdr pane so the child process receives `HERDR_ENV=1` and the Herdr pane environment.

## Per-worktree use

All worktrees owned by the configured OS account use the same global roles. For a newly added role or updated definition, run `bash tooling/install-shared-pi-agents.sh` once from any checkout containing the updated tracked `.pi/agents`, then run `/reload` or restart Pi sessions in each existing Herdr pane.

Keep the application's runtime processes separate from interactive Herdr sessions. Do not run the web/API service manager inside Herdr-managed panes.
