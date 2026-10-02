# DECISIONS

Dated log of decisions and **verified facts**. Agents append here; never delete entries (strike through if superseded).

Format: `YYYY-MM-DD | Phase/Task | Decision or verified fact | Evidence (command, doc link, file)`

| Date | Where | Entry | Evidence |
|---|---|---|---|
| 2026-10-02 | Planning | UI stack: Ink (React) on Bun, compiled with `bun build --compile` | Maintainer knows React; Ink is mature; OpenTUI judged riskier for an open-source project |
| 2026-10-02 | Planning | Podman first, Docker adapter post-v1 via `ContainerEngine` interface | Maintainer decision |
| 2026-10-02 | Planning | v1 features: bulk actions, containers/logs/env/config/stats tabs, Omarchy theme, pods and quadlets | Maintainer decision |
| 2026-10-02 | P0-T2 | Installed ink@7.1.1, react@19.3.0, typescript@7.0.2, @types/react@19.3.0, ink-testing-library@4.0.0 | bun pm ls; Ink peerDependencies: react>=19.2.0, @types/react>=19.2.0, react-devtools-core>=6.1.2 (optional) |
